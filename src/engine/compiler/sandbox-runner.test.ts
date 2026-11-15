/**
 * Tests for sandbox-runner: hardened node:vm wrapper that replaces the
 * raw `new Function()` evaluation in each generate-*.ts parseResponse.
 *
 * Cycles 5+6 of the sandbox consolidation work. Proves:
 *   - Pure-return hooks work end-to-end
 *   - Multi-arg hooks work end-to-end
 *   - ProgressionFn-shaped hooks apply mutations back to host ctx.agents
 *   - process / require / fetch / setTimeout are unreachable inside sandbox
 *   - Function-constructor reflection escape is blocked at runtime
 *   - Infinite loops are killed via the wall-clock timeout
 *   - Static validation rejects obvious banned patterns at parse time
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runArrowSync,
  runProgressionSync,
  validateHookCode,
  SandboxRunnerError,
} from './sandbox-runner.js';

test('runArrowSync executes a pure-return arrow fn', () => {
  const code = '(a, b) => a + b';
  const out = runArrowSync<[number, number], number>(code, [2, 3]);
  assert.equal(out, 5);
});

test('runArrowSync handles 5-arg fingerprint-shaped fn', () => {
  const code = '(finalState, outcomeLog, leader, toolRegs, maxTurns) => ({ outcome: outcomeLog[0]?.outcome ?? "none", maxTurns: String(maxTurns) })';
  const out = runArrowSync<[unknown, Array<{ outcome: string }>, unknown, unknown, number], Record<string, string>>(
    code,
    [{}, [{ outcome: 'win' }], { name: 'L' }, {}, 10],
  );
  assert.deepEqual(out, { outcome: 'win', maxTurns: '10' });
});

test('runArrowSync blocks process access (validation rejects pattern)', () => {
  const code = '() => process.env.SECRET';
  assert.throws(() => runArrowSync(code, []), SandboxRunnerError);
});

test('runArrowSync blocks Function-constructor reflection at runtime (codeGeneration: false)', () => {
  // The literal `Function(` is caught by validateHookCode regex.
  // The constructor reflection chain bypasses regex but should be caught
  // at runtime once the sandbox sets codeGeneration: { strings: false }.
  const code = '() => { const F = ({}).constructor.constructor; return F("return 42")(); }';
  assert.throws(
    () => runArrowSync(code, []),
    (err: Error) => /code generation|disallowed|EvalError/i.test(err.message),
  );
});

test('runArrowSync kills while(true) via timeout', () => {
  const code = '() => { while(true) {} }';
  const start = Date.now();
  assert.throws(
    () => runArrowSync(code, []),
    (err: Error) => /timed? ?out|Script execution/i.test(err.message),
  );
  // Should not take much longer than the 1000ms timeout.
  assert.ok(Date.now() - start < 3000, 'Sandbox did not honor timeout');
});

test('runArrowSync blocks realm intrinsics that enable reflection escape', () => {
  // Reflect.construct(({}).constructor.constructor, ['return process'])() is the
  // canonical reflection path that bypasses validateHookCode regex. With
  // Reflect/Proxy/WebAssembly/SharedArrayBuffer/Atomics hardened-undefined
  // in the sandbox context, those reflection paths are closed.
  const code = `() => ({
    reflect: typeof Reflect,
    proxy: typeof Proxy,
    wasm: typeof WebAssembly,
    sab: typeof SharedArrayBuffer,
    atomics: typeof Atomics,
  })`;
  const out = runArrowSync<[], Record<string, string>>(code, []);
  assert.equal(out.reflect, 'undefined');
  assert.equal(out.proxy, 'undefined');
  assert.equal(out.wasm, 'undefined');
  assert.equal(out.sab, 'undefined');
  assert.equal(out.atomics, 'undefined');
});

test('runArrowSync proves require / fetch / setTimeout are undefined inside sandbox', () => {
  const code = `() => ({
    process: typeof process,
    require: typeof require,
    fetch: typeof fetch,
    setTimeout: typeof setTimeout,
    globalThis: typeof globalThis,
  })`;
  const out = runArrowSync<[], Record<string, string>>(code, []);
  assert.equal(out.process, 'undefined');
  assert.equal(out.require, 'undefined');
  assert.equal(out.fetch, 'undefined');
  assert.equal(out.setTimeout, 'undefined');
  assert.equal(out.globalThis, 'undefined');
});

test('runProgressionSync applies mutations from sandbox back to host ctx.agents', () => {
  const code = `(ctx) => {
    for (const a of ctx.agents) {
      if (a.health.alive) {
        a.health.boneDensityPct = Math.max(0, a.health.boneDensityPct - 5);
      }
    }
  }`;
  const ctx = {
    agents: [
      { core: { name: 'A' }, health: { alive: true, boneDensityPct: 100 } },
      { core: { name: 'B' }, health: { alive: false, boneDensityPct: 80 } },
    ],
    timeDelta: 1,
    time: 2050,
    turn: 5,
    startTime: 2045,
    rng: { chance: () => false, next: () => 0.5, pick: (arr: unknown[]) => arr[0], int: (min: number) => min },
  };
  runProgressionSync(code, ctx);

  // Host's agents array (same reference) should now reflect the sandbox's mutations.
  assert.equal(ctx.agents[0].health.boneDensityPct, 95);
  assert.equal(ctx.agents[1].health.boneDensityPct, 80); // dead agent untouched
});

test('runProgressionSync blocks process escape via constructor reflection', () => {
  const code = `(ctx) => {
    const F = ({}).constructor.constructor;
    F("ctx.agents[0].pwned = process.env.SECRET")(ctx);
  }`;
  const ctx = {
    agents: [{ core: { name: 'X' }, health: { alive: true, boneDensityPct: 100 } }],
    timeDelta: 1, time: 2050, turn: 1, startTime: 2049,
    rng: { chance: () => false, next: () => 0, pick: (a: unknown[]) => a[0], int: (n: number) => n },
  };
  assert.throws(() => runProgressionSync(code, ctx), SandboxRunnerError);
  // No mutation should have leaked
  assert.equal('pwned' in ctx.agents[0], false);
});

test('validateHookCode rejects literal `process.` access', () => {
  assert.throws(
    () => validateHookCode('() => process.env.X'),
    (err: Error) => /process/i.test(err.message),
  );
});

test('validateHookCode rejects literal `require(` access', () => {
  assert.throws(
    () => validateHookCode('() => require("fs")'),
    (err: Error) => /require/i.test(err.message),
  );
});

test('validateHookCode rejects literal `eval(` and `Function(`', () => {
  assert.throws(() => validateHookCode('() => eval("1+1")'), SandboxRunnerError);
  assert.throws(() => validateHookCode('() => Function("return 1")()'), SandboxRunnerError);
});

test('validateHookCode passes safe arrow functions', () => {
  validateHookCode('(ctx) => { for (const a of ctx.agents) a.health.alive = true; }');
  validateHookCode('(a, b) => a + b');
  // No throw means pass
});

test('runProgressionSync never writes a hook\'s own __proto__ key onto the host Object.prototype', () => {
  const code = "(ctx) => { Object.defineProperty(ctx.agents[0], '__proto__', { value: { polluted: 1 }, enumerable: true }); }";
  const agent: Record<string, unknown> = { core: {} };
  try {
    runProgressionSync(code, { agents: [agent] });
    assert.equal(({} as Record<string, unknown>).polluted, undefined, 'Object.prototype was not changed');
    assert.equal(Object.getPrototypeOf(agent), Object.prototype, 'the agent keeps its prototype');
  } finally {
    delete (Object.prototype as Record<string, unknown>).polluted;
  }
});

test('runProgressionSync never swaps the prototype of a host agent\'s field', () => {
  const code = "(ctx) => { Object.defineProperty(ctx.agents[0].core, '__proto__', { value: { polluted: 1 }, enumerable: true }); ctx.agents[0].core.marsborn = true; }";
  const core: Record<string, unknown> = { marsborn: false };
  const agent: Record<string, unknown> = { core };
  try {
    runProgressionSync(code, { agents: [agent] });
    assert.equal(Object.getPrototypeOf(core), Object.prototype, 'the field keeps its prototype');
    assert.equal(core.polluted, undefined);
    assert.equal(core.marsborn, true, 'the hook\'s other changes still apply');
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  } finally {
    delete (Object.prototype as Record<string, unknown>).polluted;
  }
});

test('runProgressionSync leaves Object.prototype alone when the hook parses a __proto__ key from JSON', () => {
  const code = "(ctx) => { ctx.agents[0] = JSON.parse('{\"core\": {}, \"__proto__\": {\"polluted\": 1}}'); }";
  const agent: Record<string, unknown> = { core: {} };
  try {
    runProgressionSync(code, { agents: [agent] });
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  } finally {
    delete (Object.prototype as Record<string, unknown>).polluted;
  }
});
