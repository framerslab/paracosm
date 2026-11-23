/**
 * The executor paracosm hands AgentOS for code a department forges at run
 * time: AgentOS's QuickJS executor (`QuickJSExecutor`), with paracosm's
 * own limits in front of it.
 *
 * `QuickJSExecutor` runs each call in QuickJS compiled to WebAssembly, in an
 * instance of its own on a WebAssembly memory of its own, and drops the
 * instance when the call ends. Only data crosses between the server and
 * the forged code, and the executor declares `isolates: true`. QuickJS
 * comes from `quickjs-emscripten-core` and
 * `@jitl/quickjs-wasmfile-release-sync`, which paracosm lists in its
 * dependencies at the version AgentOS requires (`QUICKJS_VERSION`); it
 * loads once for the process, the first time a forge needs it.
 *
 * What paracosm adds, whatever a run's settings ask for:
 * - a call runs for at most {@link MAX_FORGED_CODE_TIMEOUT_MS} and holds at
 *   most {@link MAX_FORGED_CODE_MEMORY_MB}; a call that allocates past the
 *   cap ends `memory_exceeded`, and only that call's instance is dropped;
 * - a result larger than 1 MB as JSON ({@link MAX_FORGED_RESULT_BYTES}) is
 *   refused, so it reaches neither the judge's prompt nor the department;
 * - a call that carries a host function is refused: paracosm grants forged
 *   code no capability, and `QuickJSExecutor` installs every function a
 *   call carries;
 * - a source holding the word `async` or `import` is refused, the rule
 *   forge_tool applies before a test case runs (emergent-setup.ts). Only
 *   the words are checked: QuickJS has `Promise`, and a promise the
 *   function returns is awaited within the call's deadline.
 *
 * The guest runs on the server's thread: code that computes holds the
 * event loop until it returns or is stopped at its deadline.
 *
 * @module paracosm/runtime/orchestrator/forged-code-executor
 */
import {
  QuickJSExecutor,
  type ExecutorRunRequest,
  type ExecutorRunResult,
  type ForgedCodeExecutor,
} from '@framers/agentos';
import { refusedWordIn } from '../../engine/compiler/own-context.js';

/**
 * The longest one call of forged code may run, in milliseconds, whatever
 * a run's `execution.sandboxTimeoutMs` asks for. Code that computes holds
 * the event loop, so this is also the longest forged code can hold it.
 */
export const MAX_FORGED_CODE_TIMEOUT_MS = 10_000;

/**
 * The most memory one call of forged code may hold, in megabytes, whatever
 * a run's `execution.sandboxMemoryMB` asks for.
 *
 * 128 MB is the budget every run's settings already name (`sandboxMemoryMB`
 * in sim-config.ts, for a run and for the hosted demo), so the figure a run
 * reports is the one enforced. It is eight times the 16 MiB QuickJS starts
 * every call with, room for a tool that reads a small JSON input and returns
 * at most 1 MB, and it keeps a request from raising one call toward QuickJS's
 * 2,048 MiB maximum. A call's memory is freed when the server's garbage
 * collector takes the instance the call dropped, so calls that run at once
 * hold up to the sum of their budgets.
 */
export const MAX_FORGED_CODE_MEMORY_MB = 128;

/**
 * The largest result one call of forged code may return, in bytes of
 * UTF-8 as JSON: 1 MB. The judge's prompt holds every test case's result
 * in full.
 */
export const MAX_FORGED_RESULT_BYTES = 1024 * 1024;

/**
 * A forged-code time limit the server accepts: `asked` when it is a
 * positive number no greater than {@link MAX_FORGED_CODE_TIMEOUT_MS},
 * the maximum when it is greater, and the maximum (the default) when it
 * is not a positive finite number.
 */
export function clampForgedCodeTimeoutMs(asked: unknown): number {
  if (typeof asked !== 'number' || !Number.isFinite(asked) || asked <= 0) return MAX_FORGED_CODE_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_FORGED_CODE_TIMEOUT_MS, Math.floor(asked)));
}

/**
 * A forged-code memory budget the server accepts, in megabytes: `asked`
 * when it is a positive number no greater than
 * {@link MAX_FORGED_CODE_MEMORY_MB}, the maximum when it is greater, and
 * the maximum (the default) when it is not a positive finite number.
 * QuickJS runs a smaller budget than its 16 MiB starting memory at 16 MiB.
 */
export function clampForgedCodeMemoryMB(asked: unknown): number {
  if (typeof asked !== 'number' || !Number.isFinite(asked) || asked <= 0) return MAX_FORGED_CODE_MEMORY_MB;
  return Math.max(1, Math.min(MAX_FORGED_CODE_MEMORY_MB, Math.floor(asked)));
}

/**
 * AgentOS's QuickJS executor, made once for the process. A failure to load
 * (a package missing or at another version) is kept: every later forge is
 * refused with the same reason.
 */
let quickJs: Promise<QuickJSExecutor> | undefined;

function loadQuickJs(): Promise<QuickJSExecutor> {
  quickJs ??= QuickJSExecutor.create();
  return quickJs;
}

/** Runs forged code in AgentOS's QuickJS executor, under paracosm's limits. */
export class QuickJSForgedCodeExecutor implements ForgedCodeExecutor {
  readonly name = 'paracosm-quickjs-wasm';
  /**
   * `QuickJSExecutor`'s claim: the guest's heap is the call's own
   * WebAssembly memory and only data crosses. This class refuses calls in
   * front of it and hands the guest nothing more.
   */
  readonly isolates = true;

  /**
   * Loads QuickJS. The engine awaits this before a forge's test cases, so
   * a server that cannot load it refuses the forge with the reason.
   */
  async ready(): Promise<void> {
    await loadQuickJs();
  }

  async run(request: ExecutorRunRequest): Promise<ExecutorRunResult> {
    // A granted capability arrives as a host function. None is passed on.
    if (Object.keys(request.globals).length > 0) {
      return {
        status: 'error',
        error: 'Execution error: this server hands forged code no host function; forge with "allowlist": []',
        memoryUsedBytes: 0,
      };
    }
    const word = refusedWordIn(request.code);
    if (word !== null) {
      return {
        status: 'error',
        error: `Execution error: ${word}. Forged code here is synchronous: define a plain function execute(input) that returns its result.`,
        memoryUsedBytes: 0,
      };
    }

    let executor: QuickJSExecutor;
    try {
      executor = await loadQuickJs();
    } catch (err: unknown) {
      return {
        status: 'error',
        error: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
        memoryUsedBytes: 0,
      };
    }
    const ran = await executor.run({
      code: request.code,
      input: request.input,
      globals: {},
      timeoutMs: clampForgedCodeTimeoutMs(request.timeoutMs),
      memoryMB: clampForgedCodeMemoryMB(request.memoryMB),
      ...(request.signal ? { signal: request.signal } : {}),
    });

    // QuickJSExecutor refuses a result over its own 1 MB output limit; this
    // holds paracosm's limit whatever AgentOS's becomes.
    if (ran.status === 'ok' && ran.output !== undefined) {
      const bytes = Buffer.byteLength(JSON.stringify(ran.output), 'utf8');
      if (bytes > MAX_FORGED_RESULT_BYTES) {
        return {
          status: 'error',
          error: `Execution error: the result is ${bytes} bytes as JSON, over the 1 MB (${MAX_FORGED_RESULT_BYTES} bytes) a forged tool may return`,
          memoryUsedBytes: ran.memoryUsedBytes,
        };
      }
    }
    return ran;
  }
}
