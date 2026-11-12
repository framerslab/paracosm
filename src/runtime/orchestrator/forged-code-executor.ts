/**
 * The executor paracosm hands AgentOS for code a department forges at run
 * time: the forged source runs in a node:vm context of its own, the same
 * way a compiled hook does (src/engine/compiler/own-context.ts).
 *
 * AgentOS's default executor builds its context from the host's own
 * built-ins. This one hands the context nothing: the input goes in as
 * JSON text, the result comes back as one string, and the forged code can
 * reach no function the host made. It is synchronous: the context holds
 * no `Promise`, and a source with the word `async` or `import` is refused
 * with a message that says so, so `execute(input)` returns its value
 * directly.
 *
 * It declares `isolates: false`. Node's documentation says the node:vm
 * module is not a security mechanism (https://nodejs.org/api/vm.html):
 * the code runs in the host's process and on its heap, memory is not
 * limited, and AgentOS refuses to give a forge any state-changing
 * capability on an executor that does not isolate. paracosm grants forged
 * code no capability at all, and this executor refuses a call that
 * carries a host function.
 *
 * @module paracosm/runtime/orchestrator/forged-code-executor
 */
import type { ExecutorRunRequest, ExecutorRunResult, ForgedCodeExecutor } from '@framers/agentos';
import { evaluateInOwnContext } from '../../engine/compiler/own-context.js';

/**
 * The longest one call of forged code may run, in milliseconds, whatever
 * a run's `execution.sandboxTimeoutMs` asks for. The call is synchronous,
 * so this is also the longest forged code can hold the event loop.
 */
export const MAX_FORGED_CODE_TIMEOUT_MS = 10_000;

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

/** Runs forged code in a node:vm context that holds nothing of the host's. */
export class OwnContextExecutor implements ForgedCodeExecutor {
  readonly name = 'paracosm-own-context';
  readonly isolates = false;

  async run(request: ExecutorRunRequest): Promise<ExecutorRunResult> {
    // A granted capability arrives as a host function. None is passed on:
    // a function of the host inside the context is a way out of it.
    if (Object.keys(request.globals).length > 0) {
      return {
        status: 'error',
        error: 'Execution error: this server hands forged code no host function; forge with "allowlist": []',
        memoryUsedBytes: 0,
      };
    }

    // Observed, not limited: node:vm shares the host heap.
    const heapBefore = process.memoryUsage().heapUsed;
    const ending = evaluateInOwnContext({
      name: 'paracosm-forged-code',
      timeoutMs: clampForgedCodeTimeoutMs(request.timeoutMs),
      modelText: request.code,
      // Wrapped so an input of `undefined` stays `undefined` inside.
      inputJson: JSON.stringify({ input: request.input }),
      body: `  __result = (function () {
${request.code}
;
    const __entry =
      typeof execute === 'function'
        ? execute
        : (typeof run === 'function' ? run : null);
    if (!__entry) {
      throw new Error('Sandboxed tool must define execute(input) or run(input).');
    }
    return __entry(__input.input);
  })();`,
      result: 'json',
    });
    const memoryUsedBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

    switch (ending.ended) {
      case 'value':
        return { status: 'ok', output: ending.value, memoryUsedBytes };
      case 'timeout':
        return { status: 'timeout', memoryUsedBytes };
      case 'refused':
        return {
          status: 'error',
          error: `Execution error: ${ending.message}. Forged code here is synchronous: define a plain function execute(input) that returns its result.`,
          memoryUsedBytes,
        };
      case 'threw':
        return { status: 'error', error: `Execution error: ${ending.message}`, memoryUsedBytes };
    }
  }
}
