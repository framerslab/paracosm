/**
 * Emergent-tool forge + judge wiring, extracted from orchestrator.ts.
 *
 * The orchestrator needs three things to let department agents forge
 * tools at runtime:
 *   1. A shared web_search tool (multi-provider fusion + reranking)
 *   2. An EmergentCapabilityEngine (forge pipeline + judge)
 *   3. A per-dept wrapper around forge_tool that captures every attempt
 *      into a run-level ledger so the UI can show reality, not just
 *      whatever the LLM self-reports.
 *
 * All three are standalone and pure — they take their collaborators via
 * arguments and return values. Pulling them out of orchestrator.ts drops
 * ~360 lines from the god file and makes the forge machinery testable
 * without spinning up a full simulation run.
 *
 * @module paracosm/runtime/emergent-setup
 */

import type { ITool } from '@framers/agentos';
import {
  EmergentCapabilityEngine, EmergentJudge, EmergentToolRegistry,
  ComposableToolBuilder, SandboxedToolForge, ForgeToolMetaTool, generateText,
  type EmergentTool,
  wrapForgeTool as wrapForgeToolAgentOS,
  validateForgeShape,
  inferSchemaFromTestCases,
  type CapturedForge as AgentOSCapturedForge,
  type ForgeLogEvent,
} from '@framers/agentos';

// Re-export the generalized forge utilities so existing paracosm call
// sites continue to import from this module without churn.
export { validateForgeShape, inferSchemaFromTestCases };
import { DEFAULT_EXECUTION, type SimulationExecutionConfig } from '../../cli/sim-config.js';
import {
  searchCredential,
  type SearchCredentialOptions,
} from '../../engine/provider/credentials.js';
import type { LlmProvider } from '../../engine/types.js';

// ---------------------------------------------------------------------------
// Web search tool
// ---------------------------------------------------------------------------

/**
 * Multi-provider web search tool exposed to every department agent.
 *
 * Tries AgentOS WebSearchService first (Serper, Tavily, Firecrawl, Brave
 * with RRF fusion and optional Cohere rerank). Falls back to a direct
 * Serper call when the fusion service is unavailable. Missing keys
 * return a clean error payload instead of throwing.
 */
export function createWebSearchTool(
  credentials: SearchCredentialOptions = {},
  env: NodeJS.ProcessEnv | undefined = typeof process !== 'undefined' ? process.env : undefined,
): ITool {
  return {
    id: 'tool.web_search', name: 'web_search', displayName: 'Multi-Provider Web Search',
    description: 'Search for scientific papers, NASA data, and Mars research using AgentOS WebSearchService with multi-provider fusion (Serper, Tavily, Firecrawl, Brave) and Cohere neural reranking.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    hasSideEffects: false,
    async execute(args: Record<string, unknown>) {
      const query = String(args.query || '');
      const firecrawlKey = searchCredential(credentials.firecrawlKey, 'FIRECRAWL_API_KEY', env);
      const tavilyKey = searchCredential(credentials.tavilyKey, 'TAVILY_API_KEY', env);
      const serperKey = searchCredential(credentials.serperKey, 'SERPER_API_KEY', env);
      const braveKey = searchCredential(credentials.braveKey, 'BRAVE_API_KEY', env);
      const cohereKey = searchCredential(credentials.cohereKey, 'COHERE_API_KEY', env);
      try {
        const { WebSearchService, FirecrawlProvider, TavilyProvider, SerperProvider, BraveProvider } = await import('@framers/agentos/web-search');
        const service = new WebSearchService();
        if (firecrawlKey) service.registerProvider(new FirecrawlProvider(firecrawlKey));
        if (tavilyKey) service.registerProvider(new TavilyProvider(tavilyKey));
        if (serperKey) service.registerProvider(new SerperProvider(serperKey));
        if (braveKey) service.registerProvider(new BraveProvider(braveKey));
        if (!service.hasProviders()) {
          return { success: false, error: 'No search API keys configured. Set SERPER_API_KEY, TAVILY_API_KEY, FIRECRAWL_API_KEY, or BRAVE_API_KEY.' };
        }
        const results = await service.search(query, { maxResults: 5, rerank: !!cohereKey });
        return {
          success: true,
          output: {
            results: results.map(r => ({
              title: r.title, url: r.url, snippet: r.snippet,
              providers: (r as any).providerSources || [],
              relevance: (r as any).rerankScore || (r as any).rrfScore || r.relevanceScore,
            })),
            query,
            reranked: !!cohereKey,
          },
        };
      } catch {
        // Fallback: direct Serper when the fusion service isn't available.
        try {
          if (!serperKey) return { success: false, error: 'No search API keys configured' };
          const res = await fetch('https://google.serper.dev/search', {
            method: 'POST', headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query, num: 5 }),
          });
          if (!res.ok) return { success: false, error: `Search ${res.status}` };
          const data = await res.json() as any;
          return { success: true, output: { results: (data.organic || []).slice(0, 5).map((r: any) => ({ title: r.title, url: r.link, snippet: r.snippet })), query } };
        } catch (err) { return { success: false, error: String(err) }; }
      }
    },
  };
}

export const webSearchTool: ITool = createWebSearchTool();

// ---------------------------------------------------------------------------
// Emergent engine factory
// ---------------------------------------------------------------------------

/**
 * Create the emergent capability engine wired to AgentOS's forge + judge.
 *
 * @param toolMap Registry of built-in tools (web_search, etc.) that forged
 *        tools can compose against via the ComposableToolBuilder.
 * @param provider LLM provider for judge calls (openai | anthropic).
 * @param judgeModel Model ID used for judge reviews. Defaults in
 *        sim-config.ts keep this cheap — the judge runs once per forge
 *        (dozens per run) so flagship-model pricing here dominates total
 *        cost.
 * @param execution Runtime limits (sandbox timeout / memory).
 * @param onUsage Optional callback invoked after every judge LLM call so
 *        the orchestrator can fold judge spend into run-wide cost
 *        telemetry. Without this, judge costs (often 30-50% of total run
 *        spend) were invisible to `runSimulation()`'s returned `cost`.
 * @param onProviderError Optional callback invoked when the judge's LLM
 *        call throws. Forwards to the run-level provider-error
 *        classifier so quota/auth failures get reported the same way as
 *        any other call site.
 */
export function createEmergentEngine(
  toolMap: Map<string, ITool>,
  provider: LlmProvider,
  judgeModel: string,
  execution: Partial<SimulationExecutionConfig> = {},
  onUsage?: (result: { usage?: { totalTokens?: number; promptTokens?: number; completionTokens?: number; costUSD?: number } }) => void,
  onProviderError?: (err: unknown) => void,
  /**
   * Shared map that receives every approved forged tool's executable.
   * The orchestrator threads this into createCallForgedTool() so dept
   * agents in later turns can actually CALL a previously-forged tool
   * (rather than only cite it by name). Populated via the engine's
   * onToolForged callback; the same map is read by the meta-tool.
   */
  forgedExecutables?: Map<string, ITool>,
  /** Explicit provider API key for this run. */
  apiKey?: string,
) {
  const llmCb = async (model: string, prompt: string) => {
    try {
      const r = await generateText({
        provider,
        model: model || judgeModel,
        prompt,
        apiKey,
        fallbackProviders: apiKey ? [] : undefined,
      });
      onUsage?.(r);
      return r.text;
    } catch (err) {
      onProviderError?.(err);
      throw err;
    }
  };
  // Structured callback with cacheable system block. Judge's stable
  // rubric (~500 tokens) lands in the system slot with cacheBreakpoint:
  // true, so on Anthropic the second judge call onward reads cached
  // tokens at 10% of input rate. OpenAI auto-caches prompts >= 1024
  // tokens so the same savings apply. Typical run saves ~25% of judge
  // spend.
  const llmCbWithSystem = async (model: string, system: string, user: string) => {
    try {
      const r = await generateText({
        provider,
        model: model || judgeModel,
        system: [{ text: system, cacheBreakpoint: true }],
        prompt: user,
        apiKey,
        fallbackProviders: apiKey ? [] : undefined,
      });
      onUsage?.(r);
      return r.text;
    } catch (err) {
      onProviderError?.(err);
      throw err;
    }
  };

  // Session-tier tool limit. The registry was previously constructed
  // without the config so it fell through to DEFAULT_EMERGENT_CONFIG's
  // value of 10. That limit was reached by turn 3 in a 5-department
  // run (5 depts × ~2 tools each = 10) and every subsequent forge
  // failed with "Session tool limit reached". 50 comfortably fits
  // 5 depts × 6 turns × ~1.5 unique tools each ≈ 45 with headroom for
  // re-forges and composition wrappers.
  const SESSION_TOOL_LIMIT = 50;
  const AGENT_TOOL_LIMIT = 50;

  const registry = new EmergentToolRegistry({
    maxSessionTools: SESSION_TOOL_LIMIT,
    maxAgentTools: AGENT_TOOL_LIMIT,
  });
  // EmergentJudgeConfig accepts an optional `generateTextWithSystem`
  // callback for prompt caching. The installed @framers/agentos may
  // predate that field (monorepo adds it, npm publish is separate);
  // the any-cast lets the cached path activate today and TS tightens
  // automatically once the new version lands in node_modules.
  const judgeConfig = {
    judgeModel,
    promotionModel: judgeModel,
    generateText: llmCb,
    generateTextWithSystem: llmCbWithSystem,
  } as unknown as ConstructorParameters<typeof EmergentJudge>[0];
  const judge = new EmergentJudge(judgeConfig);
  const executor = async (name: string, args: unknown, ctx: any) => {
    const t = toolMap.get(name);
    return t ? t.execute(args as any, ctx) : { success: false, error: `Tool "${name}" not found` };
  };
  const engine = new EmergentCapabilityEngine({
    config: {
      enabled: true,
      maxSessionTools: SESSION_TOOL_LIMIT,
      maxAgentTools: AGENT_TOOL_LIMIT,
      sandboxTimeoutMs: execution.sandboxTimeoutMs ?? DEFAULT_EXECUTION.sandboxTimeoutMs,
      sandboxMemoryMB: execution.sandboxMemoryMB ?? DEFAULT_EXECUTION.sandboxMemoryMB,
      promotionThreshold: { uses: 5, confidence: 0.8 },
      allowSandboxTools: true, persistSandboxSource: true,
      judgeModel, promotionJudgeModel: judgeModel,
    },
    composableBuilder: new ComposableToolBuilder(executor as any),
    sandboxForge: new SandboxedToolForge(),
    judge, registry,
    // Capture every approved forged tool's executable into the shared
    // map so the call_forged_tool meta-tool can dispatch to it in
    // later turns. Without this, forged tools were citable but not
    // callable — the LLM had no path to produce fresh output from an
    // existing tool other than re-forging it.
    onToolForged: forgedExecutables
      ? async (tool: EmergentTool, executable: ITool) => {
          forgedExecutables.set(tool.name, executable);
        }
      : undefined,
  });
  return { engine, forgeTool: new ForgeToolMetaTool(engine) };
}

// ---------------------------------------------------------------------------
// call_forged_tool meta-tool
// ---------------------------------------------------------------------------

/**
 * Returns an ITool that lets dept agents execute a previously-forged
 * tool by name. Closes over the `forgedExecutables` map populated by
 * `createEmergentEngine`'s `onToolForged` callback, so tools forged in
 * turn 1 are callable by any department in turns 2+ at no forge cost.
 *
 * Without this meta-tool, the dept LLM could only cite a tool by name
 * in its JSON report (no real execution) or re-invoke `forge_tool`
 * with the same name (full judge review again, counted as re-forge).
 * Both are worse than just running the approved tool on new inputs.
 *
 * Dispatch is strict: unknown names return an error rather than
 * silently missing, so the LLM's JSON output reliably reflects what
 * actually happened.
 */
export function createCallForgedTool(forgedExecutables: Map<string, ITool>): ITool {
  return {
    id: 'tool.call_forged_tool',
    name: 'call_forged_tool',
    displayName: 'Call Forged Tool',
    description: 'Execute a previously-forged tool by name with new inputs. Use this instead of re-forging when an existing tool already covers your analysis. The tool name must match one listed in the ALREADY-FORGED TOOLS block of your context.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Machine-readable name of the tool to call (e.g. radiation_dose_calculator).' },
        args: { type: 'object', description: 'Input arguments for the tool. Must match the tool\'s declared inputSchema.' },
      },
      required: ['name'],
    },
    hasSideEffects: false,
    async execute(args: Record<string, unknown>, ctx: any) {
      const name = String(args.name || '').trim();
      if (!name) return { success: false, error: 'name is required' };
      const executable = forgedExecutables.get(name);
      if (!executable) {
        return {
          success: false,
          error: `Tool "${name}" not found. Available forged tools: ${[...forgedExecutables.keys()].join(', ') || '(none yet)'}`,
        };
      }
      try {
        const payload = (args.args && typeof args.args === 'object') ? args.args as Record<string, unknown> : {};
        const result = await executable.execute(payload, ctx);
        return result;
      } catch (err) {
        return { success: false, error: String(err).slice(0, 240) };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Forge wrapper
// ---------------------------------------------------------------------------

/**
 * Captured forge event — the ground-truth record of an actual forge call,
 * independent of whether the LLM remembered to self-report it in its JSON.
 */
export interface CapturedForge {
  name: string;
  description: string;
  mode: string;
  inputSchema: unknown;
  outputSchema: unknown;
  approved: boolean;
  confidence: number;
  output: unknown;
  errorReason?: string;
  department: string;
  /** Wall-clock ms timestamp so we can attribute forges to the surrounding event. */
  timestamp: number;
}

/**
 * Wrap the raw forge_tool meta-tool so each department's forge attempts
 * get captured + logged + normalized before they reach the engine.
 *
 * Thin adapter over AgentOS's `wrapForgeTool`. Preserves paracosm's
 * legacy positional signature (dept, capture) and wire shape
 * (CapturedForge.department) so every downstream consumer — orchestrator
 * buckets, SSE payloads, the dashboard's forge viz — keeps working
 * without a schema-level migration. Internally the AgentOS version does
 * all the normalization, shape validation, schema inference, and capture
 * — paracosm contributes the pm2-format console logging and the
 * department-shaped capture record.
 */
export function wrapForgeTool(
  raw: ForgeToolMetaTool,
  agentId: string,
  sessionId: string,
  dept: string,
  capture: (record: CapturedForge) => void,
): ITool {
  return wrapForgeToolAgentOS({
    raw,
    agentId,
    sessionId,
    scope: dept,
    capture: (record: AgentOSCapturedForge) => {
      capture({
        name: record.name,
        description: record.description,
        mode: record.mode,
        inputSchema: record.inputSchema,
        outputSchema: record.outputSchema,
        approved: record.approved,
        confidence: record.confidence,
        output: record.output,
        errorReason: record.errorReason,
        department: record.scope ?? dept,
        timestamp: record.timestamp,
      });
    },
    log: (event: ForgeLogEvent) => {
      const scopeLabel = event.scope ?? dept;
      switch (event.kind) {
        case 'start':
          console.log(`    🔧 [${scopeLabel}] Forging "${event.toolName}" (${event.mode})...`);
          break;
        case 'approved':
          console.log(
            `    🔧 [${scopeLabel}] ✓ "${event.toolName}" approved (conf ${event.confidence.toFixed(2)})`,
          );
          break;
        case 'rejected':
          console.log(`    🔧 [${scopeLabel}] ✗ "${event.toolName}" — ${event.reason}`);
          break;
        case 'error':
          console.log(`    🔧 [${scopeLabel}] ERR: ${event.error}`);
          break;
      }
    },
  });
}
