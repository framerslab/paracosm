/**
 * Hardened synchronous node:vm wrapper for paracosm's compiled hooks.
 *
 * Replaces the raw `new Function()` evaluation that previously executed
 * LLM-generated arrow functions in the host process. Each invocation
 * runs the user code in a fresh node:vm context with:
 *
 *   - `codeGeneration: { strings: false, wasm: false }` blocks runtime
 *     `eval` and `Function()` reflection that bypass static regex validation.
 *   - Frozen console + explicit `process` / `globalThis` / `require` /
 *     `setTimeout` / `setInterval` / `fetch` set to undefined.
 *   - Wall-clock `timeout` enforced via vm.runInContext.
 *
 * The sandbox is intentionally synchronous (paracosm's runtime calls these
 * hooks per-turn from sync code paths in kernel / orchestrator). Mirrors
 * the hardenings in `@framers/agentos`'s `CodeSandbox.executeJavaScript`,
 * which is async-only. Candidate for upstream consolidation when the
 * runtime allows an async refactor.
 *
 * Inputs are JSON-round-tripped into the sandbox so the user code only
 * sees sandbox-realm objects (host-realm prototype chain reflection
 * cannot reach a host `Function` constructor with permissive
 * codeGeneration).
 *
 * @module paracosm/engine/compiler/sandbox-runner
 */
import * as vm from 'node:vm';

/**
 * Keys that must NEVER be exposed inside the sandbox even if a future
 * caller passes extras. Drops them silently to keep the hardening intact.
 */
/**
 * Mirror of @framers/agentos CodeSandbox DANGEROUS_GLOBAL_KEYS so paracosm's
 * sandbox-runner has the same hardening surface as the agentos forge sandbox.
 *
 * Categorized:
 *   - Host-state escape: process, global, globalThis, require
 *   - Code-generation reflection: eval, Function
 *   - Realm-reflection / introspection: Reflect, Proxy
 *   - Memory side-channels (Spectre family): SharedArrayBuffer, Atomics
 *   - Native compilation surface: WebAssembly
 */
const DANGEROUS_GLOBAL_KEYS: ReadonlySet<string> = new Set([
  'process',
  'global',
  'globalThis',
  'require',
  'eval',
  'Function',
  'Reflect',
  'Proxy',
  'WebAssembly',
  'SharedArrayBuffer',
  'Atomics',
]);

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
}

/**
 * Build the hardened global context object for the sandbox. Provides only
 * safe builtins plus a frozen console stub. All dangerous globals are
 * explicitly nulled so any reference inside the sandbox throws a clear
 * `undefined` error rather than leaking host state.
 *
 * The `extras` parameter (currently used only for the JSON-stringified
 * args bundle and the wrapped user function) is filtered against
 * DANGEROUS_GLOBAL_KEYS before merging.
 */
function buildContext(extras: Record<string, unknown> = {}): Record<string, unknown> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const ctx: Record<string, unknown> = {
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURI,
    decodeURI,
    encodeURIComponent,
    decodeURIComponent,
    console: Object.freeze({
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
      debug: () => {},
    }),
    // Hardened-undefined: any reference inside the sandbox surfaces as
    // a clear `undefined` rather than leaking the host equivalents.
    process: undefined,
    global: undefined,
    globalThis: undefined,
    require: undefined,
    fetch: undefined,
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    clearTimeout: undefined,
    clearInterval: undefined,
    clearImmediate: undefined,
    queueMicrotask: undefined,
    // Realm intrinsics paracosm hooks have no legitimate need for. Blocks
    // Reflect.construct(Function,...) and Proxy-based prototype attacks
    // that would otherwise sidestep codeGeneration: { strings: false }.
    // SharedArrayBuffer/Atomics close the Spectre side-channel surface;
    // WebAssembly is already blocked via codeGeneration: { wasm: false }
    // but nulled here for belt-and-suspenders.
    Reflect: undefined,
    Proxy: undefined,
    WebAssembly: undefined,
    SharedArrayBuffer: undefined,
    Atomics: undefined,
  };
  for (const [key, value] of Object.entries(extras)) {
    if (!DANGEROUS_GLOBAL_KEYS.has(key)) {
      ctx[key] = value;
    }
  }
  return ctx;
}

/**
 * Translate node:vm errors into SandboxRunnerError so callers can catch
 * a single class. Preserves the underlying message for debugging.
 */
function rethrowAsSandboxError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  throw new SandboxRunnerError(`Sandbox execution failed: ${message}`);
}

/**
 * Run an LLM-generated arrow function `(...args) => result` inside the
 * hardened sandbox and return the result. Throws SandboxRunnerError on
 * validation failure, escape attempt, timeout, or thrown exception.
 *
 * Args are JSON-serialized into the sandbox source so the user code
 * only sees sandbox-realm objects.
 */
export function runArrowSync<TArgs extends unknown[], TReturn>(
  userArrowCode: string,
  args: TArgs,
): TReturn {
  validateHookCode(userArrowCode);

  const context = vm.createContext(buildContext(), {
    name: 'paracosm-hook-sandbox',
    codeGeneration: { strings: false, wasm: false },
  });

  const wrappedCode = `
    const __userFn = (${userArrowCode});
    const __args = ${JSON.stringify(args)};
    __userFn(...__args)
  `;

  let sandboxResult: unknown;
  try {
    sandboxResult = vm.runInContext(wrappedCode, context, {
      timeout: HOOK_TIMEOUT_MS,
      breakOnSigint: false,
    });
  } catch (err) {
    rethrowAsSandboxError(err);
  }

  // JSON round-trip rebases the result onto host-realm prototypes so
  // host-side equality checks (deepStrictEqual, instanceof Object)
  // behave normally. Safe for paracosm's plain-data hook outputs.
  if (sandboxResult === undefined || typeof sandboxResult !== 'object') {
    return sandboxResult as TReturn;
  }
  return JSON.parse(JSON.stringify(sandboxResult)) as TReturn;
}

/**
 * ProgressionFn-shaped hook variant: the user fn returns void and is
 * expected to mutate `ctx.agents` in place. Sandbox-side, the input is
 * JSON-cloned (so mutations land on a sandbox-realm copy), the user fn
 * is invoked for its side effects, then the mutated agents array is
 * returned to host. Host-side, this function merges each cloned agent's
 * fields back onto the original agent object so external references
 * stay stable.
 */
export function runProgressionSync(
  userArrowCode: string,
  ctx: { agents: Array<Record<string, unknown>>; [k: string]: unknown },
): void {
  validateHookCode(userArrowCode);

  const context = vm.createContext(buildContext(), {
    name: 'paracosm-hook-progression-sandbox',
    codeGeneration: { strings: false, wasm: false },
  });

  const wrappedCode = `
    const __userFn = (${userArrowCode});
    const __ctx = ${JSON.stringify(ctx)};
    __userFn(__ctx);
    __ctx.agents
  `;

  let mutatedAgents: Array<Record<string, unknown>>;
  try {
    mutatedAgents = vm.runInContext(wrappedCode, context, {
      timeout: HOOK_TIMEOUT_MS,
      breakOnSigint: false,
    }) as Array<Record<string, unknown>>;
  } catch (err) {
    rethrowAsSandboxError(err);
  }

  if (!Array.isArray(mutatedAgents)) {
    throw new SandboxRunnerError(
      'Progression hook did not return a mutated agents array',
    );
  }

  // Field-level merge back into the host agents. Preserves the host's
  // array + object identities so other runtime references stay stable.
  // A hook can give an agent or a field an own `__proto__` key (through
  // Object.defineProperty or JSON.parse); copied by assignment, it would
  // reach the host's Object.prototype or swap a host object's prototype,
  // so such keys are never copied.
  for (let i = 0; i < ctx.agents.length; i++) {
    const original = ctx.agents[i];
    const updated = mutatedAgents[i];
    if (!original || !updated) continue;
    for (const key of Object.keys(updated)) {
      if (UNMERGED_KEYS.has(key)) continue;
      const updatedField = updated[key];
      const originalField = original[key];
      if (
        originalField &&
        updatedField &&
        typeof originalField === 'object' &&
        typeof updatedField === 'object' &&
        !Array.isArray(originalField)
      ) {
        const target = originalField as Record<string, unknown>;
        const source = updatedField as Record<string, unknown>;
        for (const field of Object.keys(source)) {
          if (!UNMERGED_KEYS.has(field)) target[field] = source[field];
        }
      } else {
        original[key] = updatedField;
      }
    }
  }
}

/** Keys the progression merge never copies onto a host object. */
const UNMERGED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
