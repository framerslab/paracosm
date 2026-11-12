/**
 * Synchronous runner for paracosm's compiled hooks.
 *
 * A hook is an arrow function a model wrote. Each call evaluates its
 * source in a node:vm context of its own, through
 * {@link evaluateInOwnContext} (./own-context.ts), which says in full what
 * the context holds and what it does not. In short:
 *
 *   - The context is made from an empty object: every global and every
 *     constructor the hook can reach is the context's own, and
 *     `codeGeneration: { strings: false, wasm: false }` refuses text
 *     compiled through them.
 *   - Arguments go in as JSON text the context parses itself. The result
 *     comes back as one string the context encodes under the time limit;
 *     the host reads no property of a value the context made, and a
 *     returned function is refused.
 *   - `Promise`, `Proxy`, `Reflect`, `WebAssembly`, `SharedArrayBuffer`,
 *     `Atomics`, `globalThis` and others are deleted from the context; a
 *     hook holding the word `import` or `async` is refused before it runs.
 *   - Wall-clock `timeout` enforced via vm.runInContext.
 *
 * Node's documentation says the node:vm module is not a security mechanism
 * (https://nodejs.org/api/vm.html), and this runner does not make it one:
 * the hook runs in the host's process and on its heap, with no memory
 * limit. docs/ARCHITECTURE.md names what stays open.
 *
 * The runner is synchronous because paracosm's runtime calls these hooks
 * per-turn from sync code paths in kernel / orchestrator.
 *
 * @module paracosm/engine/compiler/sandbox-runner
 */
import { evaluateInOwnContext, refusedWordIn, type OwnContextEnding } from './own-context.js';

/**
 * Static regex blocklist applied before any code reaches the runtime.
 * Catches the common literal-pattern attempts; codeGeneration: false at
 * runtime catches the obfuscated reflection variants.
 */
const ALWAYS_BANNED_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\beval\s*\(/, 'eval() is forbidden'],
  [/\bFunction\s*\(/, 'Function() is forbidden'],
  [/\bnew\s+Function\s*\(/, 'new Function() is forbidden'],
  [/\brequire\s*\(/, 'require() is forbidden'],
  [/\bimport\s+/, 'import statements are forbidden'],
  [/\bimport\s*\(/, 'dynamic import() is forbidden'],
  [/\bprocess\s*\./, 'process access is forbidden'],
  [/\bchild_process\b/, 'child_process access is forbidden'],
  [/\bfs\s*\./, 'fs access is forbidden'],
];

/** Wall-clock timeout per hook invocation in milliseconds. */
const HOOK_TIMEOUT_MS = 1000;

/**
 * Error thrown by sandbox-runner. Distinct class so callers can detect
 * sandbox-specific failures vs ordinary user-code exceptions.
 */
export class SandboxRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxRunnerError';
  }
}

/**
 * Validate that the user-supplied arrow-function code does not contain
 * any always-banned pattern. Throws SandboxRunnerError on the first hit.
 *
 * Static regex validation alone is bypassable via obfuscation (Unicode
 * escapes, string concatenation, constructor reflection). The runtime
 * sandbox closes those gaps; this check is defense in depth and produces
 * clearer error messages than the runtime would.
 */
export function validateHookCode(code: string): void {
  for (const [pattern, message] of ALWAYS_BANNED_PATTERNS) {
    if (pattern.test(code)) {
      throw new SandboxRunnerError(`Sandbox validation failed: ${message}`);
    }
  }
  // The two words the context cannot be left holding: see own-context.ts.
  const word = refusedWordIn(code);
  if (word !== null) {
    throw new SandboxRunnerError(`Sandbox validation failed: ${word}`);
  }
}

/**
 * The value an evaluation ended with, or a SandboxRunnerError carrying
 * its message, so callers catch a single class.
 */
function valueOrThrow(ending: OwnContextEnding): unknown {
  if (ending.ended === 'value') return ending.value;
  throw new SandboxRunnerError(`Sandbox execution failed: ${ending.message}`);
}

/**
 * Run an LLM-generated arrow function `(...args) => result` in a context
 * of its own and return the result. Throws SandboxRunnerError on
 * validation failure, a refused result, timeout, or thrown exception.
 *
 * Args go in as JSON text, so the hook only sees values its own context
 * made. A primitive result comes back as it is (`undefined`, `NaN` and
 * `-0` included); an object comes back through JSON, as host data; a
 * function or a symbol is refused.
 */
export function runArrowSync<TArgs extends unknown[], TReturn>(
  userArrowCode: string,
  args: TArgs,
): TReturn {
  validateHookCode(userArrowCode);

  const ending = evaluateInOwnContext({
    name: 'paracosm-hook-sandbox',
    timeoutMs: HOOK_TIMEOUT_MS,
    modelText: userArrowCode,
    inputJson: JSON.stringify(args),
    body: `  const __userFn = (${userArrowCode});
  __result = __userFn(...__input);`,
    result: 'typed',
  });
  return valueOrThrow(ending) as TReturn;
}

/**
 * ProgressionFn-shaped hook variant: the user fn returns void and is
 * expected to mutate `ctx.agents` in place. The context parses a JSON
 * copy of `ctx` (so mutations land on the context's own copy), the user
 * fn is invoked for its side effects, then the mutated agents array
 * comes back through JSON as host data. Host-side, this function merges
 * each returned agent's fields back onto the original agent object so
 * external references stay stable.
 */
export function runProgressionSync(
  userArrowCode: string,
  ctx: { agents: Array<Record<string, unknown>>; [k: string]: unknown },
): void {
  validateHookCode(userArrowCode);

  const ending = evaluateInOwnContext({
    name: 'paracosm-hook-progression-sandbox',
    timeoutMs: HOOK_TIMEOUT_MS,
    modelText: userArrowCode,
    inputJson: JSON.stringify(ctx),
    body: `  const __userFn = (${userArrowCode});
  __userFn(__input);
  __result = __input.agents;`,
    result: 'typed',
  });
  const mutatedAgents = valueOrThrow(ending) as Array<Record<string, unknown>>;

  if (!Array.isArray(mutatedAgents)) {
    throw new SandboxRunnerError(
      'Progression hook did not return a mutated agents array',
    );
  }

  // Field-level merge back into the host agents. Preserves the host's
  // array + object identities so other runtime references stay stable.
  for (let i = 0; i < ctx.agents.length; i++) {
    const original = ctx.agents[i];
    const updated = mutatedAgents[i];
    if (!original || !updated) continue;
    for (const key of Object.keys(updated)) {
      const updatedField = updated[key];
      const originalField = original[key];
      if (
        originalField &&
        updatedField &&
        typeof originalField === 'object' &&
        typeof updatedField === 'object' &&
        !Array.isArray(originalField)
      ) {
        Object.assign(originalField as object, updatedField as object);
      } else {
        original[key] = updatedField;
      }
    }
  }
}
