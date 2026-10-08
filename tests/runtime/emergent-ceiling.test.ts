/**
 * paracosm's engine grants forged code no capabilities: a forge that asks for
 * one is refused before the judge is asked, and the engine runs no code
 * without a ceiling.
 *
 * @module tests/runtime/emergent-ceiling
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEmergentEngine } from '../../src/runtime/orchestrator/emergent-setup.js';

describe("forged code under paracosm's ceiling", () => {
  it('refuses a forge that asks for fetch, naming that nothing is granted, and logs no unscoped line', async () => {
    const lines: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    let built: ReturnType<typeof createEmergentEngine>;
    try {
      built = createEmergentEngine(new Map(), 'openai', 'judge-model');
    } finally {
      console.warn = warn;
    }
    assert.equal(lines.some((line) => line.includes('without a ceiling')), false);

    const result = await built.engine.forge(
      {
        name: 'fetch_it',
        description: 'Fetches a page.',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        outputSchema: { type: 'object', properties: { status: { type: 'number' } } },
        implementation: {
          mode: 'sandbox',
          code: 'async function execute(input) { const r = await fetch(input.url); return { status: r.status }; }',
          allowlist: ['fetch'],
        },
        testCases: [{ input: { url: 'https://example.com' } }],
      },
      { agentId: 'dept-test', sessionId: 'sess-test' },
    );
    assert.equal(result.success, false);
    assert.match(String(result.error), /capability_not_granted: fetch; this host grants no capability/);
  });
});
