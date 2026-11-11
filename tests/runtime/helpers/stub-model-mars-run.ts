/**
 * A Mars Genesis run through the real turn loop with a stub model in place
 * of the provider.
 *
 * `runSimulation` reaches its model through AgentOS's OpenAI provider, which
 * sends every call with the global `fetch`. The stub answers that `fetch`
 * and nothing reaches a network: the model list, then each chat call. The
 * commander's two decisions get the replies Aria Chen wrote in the hosted
 * Mars Genesis pair of 11 November 2026 at 07:39 UTC (seed 950, 30 people,
 * three departments), recorded in
 * tests/fixtures/mars-live-decisions-2026-11.json under `ruleReplies`:
 * Landfall, where she took the canyon rim (option_b), and Legacy
 * Assessment, where she gave the honest report (option_a). Every other call
 * (the commander's first message, the promotions, the department reports,
 * the reactions) gets `{}`, which fails its schema, so the run takes the
 * fallback the code keeps for a model that answers badly: the top
 * candidate as head, the empty report, no reactions.
 *
 * Two turns: Mars plays its two milestones (turn 1 and the final turn), so
 * the run makes no Event Director call.
 */
import { readFileSync } from 'node:fs';
import { runSimulation } from '../../../src/runtime/orchestrator/index.js';
import { marsScenario } from '../../../src/engine/scenarios/index.js';
import type { RunArtifact } from '../../../src/engine/schema/index.js';

/** The line only the commander's decision prompt carries (the options block). */
const DECISION_PROMPT_MARK = 'You MUST include "selectedOptionId"';

interface RecordedRun {
  leader: string;
  decisions: Array<{ title: string; reply: Record<string, unknown> }>;
}

const recorded = JSON.parse(
  readFileSync(new URL('../../fixtures/mars-live-decisions-2026-11.json', import.meta.url), 'utf-8'),
) as { ruleReplies: { runs: RecordedRun[] } };
const aria = recorded.ruleReplies.runs.find(r => r.leader === 'Aria Chen');
if (!aria) throw new Error('the fixture holds Aria Chen\'s recorded replies');
/** Aria Chen's recorded reply for each event title. */
const REPLIES = new Map(aria.decisions.map(d => [d.title, d.reply]));

/** What the stub model saw and answered. */
export interface StubModelLog {
  /** Every URL the run fetched, in order. */
  urls: string[];
  /** The titles of the decision prompts it answered with a recorded reply, in order. */
  decisions: string[];
}

/** The text of a chat or Responses message's content: a string, or text parts. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
      ? (part as { text: string }).text
      : '')).join('');
  }
  return '';
}

/** The last user message of a chat `messages` list or a Responses `input` list. */
function lastUserText(messages: unknown): string {
  if (typeof messages === 'string') return messages;
  if (!Array.isArray(messages)) return '';
  const users = messages.filter(m => m && typeof m === 'object' && (m as { role?: unknown }).role === 'user');
  return textOf((users.at(-1) as { content?: unknown } | undefined)?.content);
}

/** The reply to one prompt: a recorded decision for the commander's decision prompt, else `{}`. */
function replyTo(prompt: string, log: StubModelLog): string {
  if (!prompt.includes(DECISION_PROMPT_MARK)) return '{}';
  // The decision prompt opens "TURN 1, Year 2035: Landfall".
  const title = /^TURN \d+[^:\n]*: (.+)$/m.exec(prompt)?.[1]?.trim() ?? '';
  const reply = REPLIES.get(title);
  if (!reply) return '{}';
  log.decisions.push(title);
  return JSON.stringify(reply);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** One chat completion, whole or as a stream, as OpenAI sends it. */
function chatCompletion(model: string, text: string, stream: boolean): Response {
  const head = { id: 'chatcmpl-stub', created: 0, model };
  if (!stream) {
    return json({
      ...head,
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }
  const chunks = [
    { ...head, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { ...head, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { ...head, object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ];
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A `fetch` that answers as the OpenAI API would and sends nothing. */
function stubFetch(log: StubModelLog): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    log.urls.push(url);
    const path = new URL(url).pathname;
    const raw = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : '';
    const body = (raw ? JSON.parse(raw) : {}) as { model?: string; messages?: unknown; input?: unknown; stream?: boolean };
    const model = body.model ?? 'gpt-4o';
    if (path.endsWith('/models')) {
      return json({ object: 'list', data: ['gpt-4o', 'gpt-4o-mini'].map(id => ({ id, object: 'model', created: 0, owned_by: 'openai' })) });
    }
    if (path.endsWith('/chat/completions')) {
      return chatCompletion(model, replyTo(lastUserText(body.messages), log), body.stream === true);
    }
    if (path.endsWith('/responses')) {
      const text = replyTo(lastUserText(body.input), log);
      return json({
        id: 'resp-stub', object: 'response', created_at: 0, model, status: 'completed',
        output: [{ type: 'message', id: 'msg-stub', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
    }
    return json({ error: { message: `the stub model serves no ${path}`, type: 'invalid_request_error' } }, 404);
  }) as typeof fetch;
}

/**
 * Run Mars Genesis for two turns with Aria Chen, the turn loop's snapshots
 * on, and the stub model. Returns the artifact the run saved and what the
 * stub answered.
 */
export async function runMarsWithStubModel(): Promise<{ artifact: RunArtifact; log: StubModelLog }> {
  const log: StubModelLog = { urls: [], decisions: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(log);
  try {
    const leader = marsScenario.presets[0].leaders[0];
    const artifact = await runSimulation({ ...leader, unit: 'Colony Alpha' } as never, [], {
      scenario: marsScenario,
      maxTurns: 2,
      seed: 950,
      initialPopulation: 30,
      activeDepartments: ['medical', 'engineering', 'agriculture'] as never,
      captureSnapshots: true,
      provider: 'openai',
      apiKey: 'placeholder-key-for-a-test',
      models: { commander: 'gpt-4o', departments: 'gpt-4o', judge: 'gpt-4o', director: 'gpt-4o', agentReactions: 'gpt-4o' },
    });
    return { artifact, log };
  } finally {
    globalThis.fetch = realFetch;
  }
}
