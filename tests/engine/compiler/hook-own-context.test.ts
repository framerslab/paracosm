/**
 * A compiled hook runs on values of its own context.
 *
 * The hook runner (src/engine/compiler/sandbox-runner.ts) evaluates a
 * hook's source in a node:vm context. These tests hold what that context
 * is made of and what crosses its edge:
 *
 * - every global a hook can name is one the context made itself, so its
 *   constructor is the context's own and compiles no text;
 * - the names the runner takes out of the context are not there;
 * - arguments arrive as data and a result leaves as data: a function is
 *   refused, and a value that runs code when it is read is read inside the
 *   context, under the runner's time limit;
 * - nothing a hook starts goes on after the call returns.
 *
 * The calls whose outcome is "the calling process goes on" run in a
 * process of their own (tests/engine/compiler/helpers/hook-probe.ts), so a
 * failure is one failed test and never a held or stopped test run. The
 * last test compiles a scenario with the real `compileFromSeed` on the
 * stub model (tests/runtime/helpers/stub-openai-transport.ts), as the
 * compile routes do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runArrowSync, SandboxRunnerError } from '../../../src/engine/compiler/sandbox-runner.js';
import { compileFromSeed } from '../../../src/engine/compiler/compile-from-seed.js';
import { stubFailure, withStubOpenAi, type StubReply } from '../../runtime/helpers/stub-openai-transport.js';
import { isDraftRequest, isExtractionRequest, loadCompilerFixture, ORCHARD_SEED_TEXT } from './helpers/stub-model-compile.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROBE = fileURLToPath(new URL('./helpers/hook-probe.ts', import.meta.url));

/** How one call ended in a process of its own. */
interface ProbeOutcome {
  /** The first line the probe printed, parsed; null when it printed none. */
  line: { ended?: string; type?: string; sandbox?: boolean; message?: string } | null;
  /** True when the probe's timer ran after the call. */
  settled: boolean;
  /** The exit code; null when the process was stopped at the time limit. */
  status: number | null;
}

/** Run one call through tests/engine/compiler/helpers/hook-probe.ts, stopping it after 20 seconds. */
function probe(request: Record<string, unknown>): ProbeOutcome {
  const out = spawnSync(process.execPath, ['--import', 'tsx', '--import', './scripts/test-css-stub.mjs', PROBE, JSON.stringify(request)], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20_000,
    killSignal: 'SIGKILL',
  });
  const lines = (out.stdout ?? '').split('\n').filter(Boolean);
  let line: ProbeOutcome['line'] = null;
  try {
    line = lines[0] ? JSON.parse(lines[0]) : null;
  } catch {
    line = null;
  }
  return { line, settled: lines.includes('settled'), status: out.status };
}

/** The call threw the runner's own error and the process went on to its timer and a clean exit. */
function assertRefusedAndSettled(outcome: ProbeOutcome, what: string): void {
  const read = JSON.stringify(outcome);
  assert.equal(outcome.line?.ended, 'threw', `${what}: the call throws (read ${read})`);
  assert.equal(outcome.line?.sandbox, true, `${what}: it throws SandboxRunnerError (read ${read})`);
  assert.equal(outcome.settled, true, `${what}: the process goes on after the call (read ${read})`);
  assert.equal(outcome.status, 0, `${what}: the process exits cleanly (read ${read})`);
}

/** Expressions a hook can write that name a function the context holds. */
const FUNCTIONS_A_HOOK_CAN_NAME = [
  'Math.max', 'JSON.parse', 'Date', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Map', 'Set', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent', 'console.log',
  // Names every object answers to, read as bare globals.
  'valueOf', 'hasOwnProperty', 'toString', 'isPrototypeOf', 'constructor',
] as const;

test('every function a hook can name was made by the hook\'s own context', () => {
  const body = FUNCTIONS_A_HOOK_CAN_NAME
    .map(name => `${JSON.stringify(name)}: ${name}.constructor === own`)
    .join(', ');
  const code = `() => { const own = (() => 0).constructor; return { ${body} }; }`;
  const seen = runArrowSync<[], Record<string, boolean>>(code, []);
  const expected: Record<string, boolean> = {};
  for (const name of FUNCTIONS_A_HOOK_CAN_NAME) expected[name] = true;
  assert.deepEqual(seen, expected);
});

for (const name of ['Math.max', 'JSON.parse', 'Object', 'Date', 'console.log', 'valueOf', 'constructor'] as const) {
  test(`the constructor of ${name} compiles no text for a hook`, () => {
    assert.throws(() => runArrowSync(`() => ${name}.constructor('return 7')()`, []), SandboxRunnerError);
  });
}

test('a hook finds none of the names the runner takes out of its context', () => {
  const code = `() => ({
    promise: typeof Promise,
    fromAsync: typeof Array.fromAsync,
    arrayBuffer: typeof ArrayBuffer,
    typedArray: typeof Uint8Array,
    weakRef: typeof WeakRef,
    finalizationRegistry: typeof FinalizationRegistry,
    symbolFor: typeof Symbol.for,
  })`;
  assert.deepEqual(runArrowSync<[], Record<string, string>>(code, []), {
    promise: 'undefined',
    fromAsync: 'undefined',
    arrayBuffer: 'undefined',
    typedArray: 'undefined',
    weakRef: 'undefined',
    finalizationRegistry: 'undefined',
    symbolFor: 'undefined',
  });
});

test('an argument arrives as data: a key named __proto__ stays a key', () => {
  const arg: unknown = JSON.parse('{"__proto__":{"x":1},"k":1}');
  const seen = runArrowSync<[unknown], [boolean, string[]]>(
    '(a) => [Object.getPrototypeOf(a) === Object.prototype, Object.keys(a)]',
    [arg],
  );
  assert.deepEqual(seen, [true, ['__proto__', 'k']]);
});

test('a hook that returns a function is refused', () => {
  assert.throws(() => runArrowSync('() => () => 1', []), SandboxRunnerError);
  assert.throws(() => runArrowSync('() => function named() { return 1; }', []), SandboxRunnerError);
});

test('a hook with a comment between `import` and its parenthesis is refused before it runs', () => {
  assertRefusedAndSettled(
    probe({ kind: 'arrow', code: "() => import/**/('node:fs')" }),
    'a dynamic import written with a comment',
  );
});

test('a result that runs code when it is read is read under the runner\'s time limit', () => {
  assertRefusedAndSettled(
    probe({ kind: 'arrow', code: '() => ({ get a() { for (;;) {} } })' }),
    'a result with a getter that never returns',
  );
  assertRefusedAndSettled(
    probe({ kind: 'arrow', code: '() => ({ toJSON() { for (;;) {} } })' }),
    'a result with a toJSON that never returns',
  );
});

test('a thrown value that runs code when it is read is read under the runner\'s time limit', () => {
  assertRefusedAndSettled(
    probe({ kind: 'arrow', code: '() => { throw { toString() { for (;;) {} } }; }' }),
    'a thrown object with a toString that never returns',
  );
  assertRefusedAndSettled(
    probe({
      kind: 'arrow',
      code: "() => { throw Object.defineProperty(new Error('x'), 'message', { get() { for (;;) {} } }); }",
    }),
    'a thrown error with a message getter that never returns',
  );
});

test('nothing a hook starts goes on after the call returns', () => {
  assertRefusedAndSettled(
    probe({ kind: 'arrow', code: '() => { Promise.resolve().then(() => { for (;;) {} }); return 1; }' }),
    'a promise job that never returns',
  );
  assertRefusedAndSettled(
    probe({ kind: 'arrow', code: '() => { (async () => { await 0; for (;;) {} })(); return 1; }' }),
    'an async function that never returns after its first await',
  );
  assertRefusedAndSettled(
    probe({ kind: 'arrow', code: "() => { Promise.reject(new Error('left')); return 1; }" }),
    'a rejected promise nobody handles',
  );
});

test('agents a progression hook hands back are read under the runner\'s time limit', () => {
  assertRefusedAndSettled(
    probe({
      kind: 'progression',
      code: "(ctx) => { Object.defineProperty(ctx.agents[0], 'x', { get() { for (;;) {} }, enumerable: true }); }",
      ctx: { agents: [{ core: { name: 'A' }, health: { alive: true } }], timeDelta: 1, time: 1, turn: 1, startTime: 0 },
    }),
    'an agent with a getter that never returns',
  );
});

test('a primitive result comes back as it is, and an object comes back as host data', () => {
  assert.equal(runArrowSync('() => undefined', []), undefined);
  assert.equal(runArrowSync('() => null', []), null);
  assert.equal(runArrowSync('() => true', []), true);
  assert.equal(runArrowSync('() => false', []), false);
  assert.equal(runArrowSync("() => 'text'", []), 'text');
  assert.equal(runArrowSync("() => ''", []), '');
  assert.equal(runArrowSync('() => 3.5', []), 3.5);
  assert.equal(runArrowSync('() => 1e21', []), 1e21);
  assert.ok(Number.isNaN(runArrowSync('() => NaN', [])));
  assert.equal(runArrowSync('() => -Infinity', []), -Infinity);
  assert.ok(Object.is(runArrowSync('() => -0', []), -0));
  assert.equal(runArrowSync('() => 10n ** 20n', []), 10n ** 20n);
  const data = runArrowSync<[{ list: number[] }], { list: number[]; when: unknown; skipped?: unknown }>(
    '(a) => ({ list: a.list.map((n) => n * 2), when: new Date(0), skipped: undefined })',
    [{ list: [1, 2] }],
  );
  assert.deepEqual(data, { list: [2, 4], when: '1970-01-01T00:00:00.000Z' });
  assert.equal(Object.getPrototypeOf(data), Object.prototype);
  assert.ok(Array.isArray(data.list));
});

test('a hook that throws is reported with the text of what it threw', () => {
  assert.throws(
    () => runArrowSync('(ctx) => ctx.rng.chance(0.5)', [{ rng: {} }]),
    (err: unknown) => err instanceof SandboxRunnerError && /TypeError: ctx\.rng\.chance is not a function/.test(err.message),
  );
  assert.throws(
    () => runArrowSync("() => { throw 'plain text'; }", []),
    (err: unknown) => err instanceof SandboxRunnerError && /plain text/.test(err.message),
  );
});

test('a hook holding the word `async` or `import` is refused with a reason that names the word', () => {
  assert.throws(
    () => runArrowSync('async () => 1', []),
    (err: unknown) => err instanceof SandboxRunnerError && /`async`/.test(err.message),
  );
  assert.throws(
    () => runArrowSync("() => 'the import tariff'", []),
    (err: unknown) => err instanceof SandboxRunnerError && /import/.test(err.message),
  );
});

test('a hook has a console that does nothing, no stack traces, and the built-ins a calculation uses', () => {
  const seen = runArrowSync<[number[]], Record<string, unknown>>(
    `(xs) => {
      console.log('ignored'); console.warn('ignored');
      const total = xs.reduce((a, b) => a + b, 0);
      return {
        total,
        max: Math.max(...xs),
        keys: Object.keys({ a: 1, b: 2 }),
        set: [...new Set(xs)].length,
        map: new Map([['k', 1]]).get('k'),
        text: JSON.stringify({ n: Number('4') }),
        match: /b+/.exec('abbc')[0],
        fixed: (1234.5).toFixed(1),
        framesInStack: String(new Error('x').stack).indexOf('    at ') !== -1,
        isError: new TypeError('x') instanceof Error,
      };
    }`,
    [[3, 1, 3]],
  );
  assert.deepEqual(seen, {
    total: 7, max: 3, keys: ['a', 'b'], set: 2, map: 1, text: '{"n":4}', match: 'bb', fixed: '1234.5',
    framesInStack: false, isError: true,
  });
});

/** The mark this test's politics hook would leave on the process's own global object. */
const MARK = '__paracosmHookOwnContextMark';

/** A working source for each code hook, by the first line of its system block; the politics hook is the one under test. */
const HOOK_SOURCES: ReadonlyArray<readonly [mark: string, source: string]> = [
  ['You are generating a between-turn progression hook', '(ctx) => {}'],
  ['You are generating a department prompt hook', "(ctx) => ['Scores held: ' + Object.keys(ctx.state.metrics).join(', ')]"],
  ['You are generating a timeline fingerprint hook', "(finalState) => ({ summary: Object.keys(finalState.metrics).length + ' scores held' })"],
  ['You are generating a politics hook', `(category, outcome) => { Math.max.constructor('globalThis.${MARK} = true')(); return null; }`],
  ['You are generating a reaction context hook', "(colonist, ctx) => 'Steady after the last turn.'"],
];

test('a compile runs a generated hook\'s statements in the hook\'s context only', async () => {
  const holder = globalThis as Record<string, unknown>;
  delete holder[MARK];
  const draft = JSON.stringify(loadCompilerFixture('draft-orchard-bare.json'));
  const extraction = JSON.stringify(loadCompilerFixture('extraction-orchard.json'));
  const reply: StubReply = (request) => {
    if (isDraftRequest(request)) return draft;
    if (isExtractionRequest(request)) return extraction;
    if (request.system.includes('You are generating ')) {
      return HOOK_SOURCES.find(([mark]) => request.system.includes(mark))?.[1] ?? '{}';
    }
    return '{}';
  };
  try {
    const scenario = await withStubOpenAi(reply, async (seen) => {
      try {
        return await compileFromSeed({ seedText: ORCHARD_SEED_TEXT }, {
          provider: 'openai',
          model: 'gpt-4o',
          draftProvider: 'openai',
          draftModel: 'gpt-4o',
          apiKey: 'placeholder-key-for-a-test',
          cache: false,
          webSearch: false,
        });
      } catch (err) {
        throw stubFailure('compileFromSeed on the stub model', err, seen);
      }
    });
    assert.equal(holder[MARK], undefined, 'the politics hook set nothing on the process\'s own global object');
    assert.equal(typeof scenario.id, 'string', 'the compile still returns a scenario');
    // The compiler keeps its own fallback when a generated hook does not pass.
    assert.equal(scenario.hooks?.politicsHook?.('political', 'risky_success') ?? null, null);
  } finally {
    delete holder[MARK];
  }
});
