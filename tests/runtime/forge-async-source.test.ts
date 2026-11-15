/**
 * A department that forges a tool written as an async function is told
 * the rule before anything runs, and is told it before it writes one.
 *
 * Forged code here runs synchronously in a context that holds no Promise
 * (src/runtime/orchestrator/forged-code-executor.ts), so a source holding
 * the word `async` can never pass a test case. These tests call the tool
 * a department is handed: `createEmergentEngine`'s `forge_tool`, wrapped
 * by `wrapForgeTool` as the orchestrator wraps it for each department.
 * The judge is answered by the stub transport
 * (tests/runtime/helpers/stub-openai-transport.ts), which records every
 * request, so a judge call shows there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmergentEngine, wrapForgeTool, type CapturedForge } from '../../src/runtime/orchestrator/emergent-setup.js';
import { buildForgeGuidance } from '../../src/runtime/orchestrator/forge-guidance.js';
import { describeExchanges, withStubOpenAi } from './helpers/stub-openai-transport.js';

/** The judge reply that approves a forge (EmergentJudge's creation verdict shape). */
const APPROVE = JSON.stringify({
  safety: { passed: true, concerns: [] },
  correctness: { passed: true, failedTests: [] },
  determinism: { likely: true, reasoning: '' },
  bounded: { likely: true, reasoning: '' },
  confidence: 0.9,
  approved: true,
  reasoning: 'The outputs match the inputs.',
});

/** A forge request that passes the shape check, with `code` as its implementation. */
function forgeRequest(code: string): Record<string, unknown> {
  return {
    name: 'both_present',
    description: 'Says whether both numbers are present.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    implementation: { mode: 'sandbox', code, allowlist: [] },
    testCases: [
      { input: { a: 1, b: 2 }, expectedOutput: { ok: true } },
      { input: { a: 0, b: 0 }, expectedOutput: { ok: true } },
    ],
  };
}

/** The forge_tool a department is handed, with what it captured. */
function departmentForgeTool() {
  const { forgeTool } = createEmergentEngine(
    new Map(), 'openai', 'gpt-4o', {}, undefined, undefined, undefined, 'placeholder-key-for-a-test',
  );
  const captured: CapturedForge[] = [];
  const tool = wrapForgeTool(forgeTool, 'sess-test-medical', 'sess-test', 'medical', record => captured.push(record));
  return { tool, captured };
}

/** Every `description` under the tool's `implementation` schema, joined. */
function implementationDescriptions(schema: unknown): string {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'description' && typeof value === 'string') found.push(value);
        else walk(value);
      }
    }
  };
  walk((schema as { properties?: { implementation?: unknown } }).properties?.implementation);
  return found.join('\n');
}

test('a forge written as an async function is refused before a test case runs or a judge reads it', async () => {
  const { result, captured, judgeCalls, sent } = await withStubOpenAi(() => APPROVE, async (seen) => {
    const { tool, captured: records } = departmentForgeTool();
    const answer = await tool.execute(forgeRequest('async function execute(input) { return { ok: true } }'), {} as never);
    const calls = seen.filter(exchange => !exchange.path.endsWith('/models'));
    return { result: answer, captured: records, judgeCalls: calls.length, sent: describeExchanges(seen) };
  });
  assert.equal(judgeCalls, 0, `no judge call is spent on a source that cannot run here (the model was sent:\n${sent})`);
  assert.equal(result.success, false, 'the forge is refused');
  assert.match(String(result.error), /synchronous/, 'the refusal says the code is synchronous');
  assert.match(String(result.error), /function execute\(input\)/, 'the refusal says what to write');
  assert.match(String(result.error), /async/, 'the refusal names the word');
  assert.equal(captured.length, 1, 'the refused forge is recorded once for the department');
  assert.equal(captured[0]?.approved, false, 'it is recorded as not approved');
  assert.match(String(captured[0]?.errorReason), /synchronous/, 'with the reason');
});

test('the same tool written as a plain function is tested, judged and registered', async () => {
  const { result, judgeCalls } = await withStubOpenAi(() => APPROVE, async (seen) => {
    const { tool } = departmentForgeTool();
    const answer = await tool.execute(forgeRequest('function execute(input) { return { ok: true } }'), {} as never);
    return { result: answer, judgeCalls: seen.filter(exchange => !exchange.path.endsWith('/models')).length };
  });
  assert.equal(result.success, true, `the forge is registered (read ${JSON.stringify(result.error ?? null)})`);
  assert.ok(judgeCalls >= 1, 'the judge reviewed it');
});

test('the forge_tool a department is handed describes its code as synchronous and offers no async form', () => {
  const { tool } = departmentForgeTool();
  const described = implementationDescriptions(tool.inputSchema);
  assert.match(described, /function execute\(input\)/, 'the description still names the function to define');
  assert.doesNotMatch(described, /async equivalent/, 'it offers no async form, which this server refuses');
  assert.match(described, /synchronous/i, 'it says the code is synchronous');
});

test('the forge guidance lists the synchronous rule among the rules that cost an attempt', () => {
  const guidance = buildForgeGuidance('medical');
  const hardRules = guidance.slice(guidance.indexOf('HARD RULES'), guidance.indexOf('#1 FORGE REJECTION REASON'));
  assert.ok(hardRules.length > 0, 'the guidance holds its hard rules');
  assert.match(hardRules, /synchronous/i, 'the hard rules say the code is synchronous');
  assert.match(hardRules, /async/, 'they name the word that is refused');
});
