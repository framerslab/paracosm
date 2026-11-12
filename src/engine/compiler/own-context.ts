/**
 * Runs text a model wrote in a node:vm context that holds nothing of the
 * host's.
 *
 * Read this first: Node's documentation says "The node:vm module is not a
 * security mechanism. Do not use it to run untrusted code."
 * (https://nodejs.org/api/vm.html). This module does not change that. The
 * code still runs in the host's process and on the host's heap, and a
 * defect in V8 or in Node's context code is not contained. What this
 * module does is close every path its authors could name:
 *
 * - **Nothing of the host goes in.** The context is made from an object
 *   with no prototype and no properties. The input is JSON text, parsed by
 *   the context's own `JSON.parse`, so every value the code sees was made
 *   by the context, and every constructor it can reach is the context's.
 *   `codeGeneration: { strings: false, wasm: false }` refuses text and
 *   WebAssembly compiled through those constructors.
 * - **Only a string comes out.** The result is encoded inside the context,
 *   under the time limit, and leaves as one primitive string. The host
 *   reads no property of a value the context made: not of a result, and
 *   not of a thrown value, which it describes with `node:util`'s type
 *   checks only. A function is never returned and never called.
 * - **Globals are an allow-list.** Every other global is deleted from the
 *   context before the code runs: `Promise`, `Proxy`, `Reflect`,
 *   `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `WeakRef`,
 *   `FinalizationRegistry`, `ArrayBuffer` and the typed arrays,
 *   `globalThis`, `eval` and V8's own `console` among them, along with
 *   `Array.fromAsync`, `Symbol.for` and `Symbol.keyFor`.
 * - **No promise exists.** With no `Promise`, no `async` function (the word
 *   is refused in the text) and no `Array.fromAsync`, the code cannot make
 *   one, so nothing is left queued when the call returns and nothing
 *   reaches the process's handling of unhandled rejections. The context
 *   also has a microtask queue of its own (`microtaskMode: 'afterEvaluate'`),
 *   drained inside the time limit.
 * - **No dynamic import.** The word `import` is refused in the text. Node
 *   answers a context's `import()` with a rejection made by the host.
 * - **No stack traces.** `Error.stackTraceLimit` is fixed at a value that
 *   is not a number, so V8 records no frames for the context's errors and
 *   Node's stack formatter never runs for them.
 * - **A time limit.** `vm.runInContext`'s `timeout` ends a loop, including
 *   one inside a getter or a `toJSON` the encoder reads.
 * - **Node reads nothing after the limit either.** `displayErrors: false`
 *   stops Node reading the `stack` of a thrown value, and
 *   `Error.prototype.code` is fixed as a plain data property, so the `code`
 *   Node sets on its own time-limit error, which it makes inside the
 *   context, runs no setter.
 *
 * What stays open: memory is not limited (code that fills the heap ends
 * the process), a long-running built-in is not interrupted until it
 * returns, and the two word checks refuse any text that holds `import` or
 * `async` as a word, in a string or a comment too.
 *
 * @module paracosm/engine/compiler/own-context
 */
import * as vm from 'node:vm';
import { types } from 'node:util';

/** How one evaluation ended. */
export type OwnContextEnding =
  /** The code returned; `value` is host data decoded from the context's string. */
  | { ended: 'value'; value: unknown }
  /** The code threw; `message` was written inside the context. */
  | { ended: 'threw'; message: string }
  /** The time limit ended the code. */
  | { ended: 'timeout'; message: string }
  /** The text was refused before it ran, or its result cannot leave the context. */
  | { ended: 'refused'; message: string };

/** What {@link evaluateInOwnContext} is asked to run. */
export interface OwnContextRequest {
  /** The context's name, as Node's inspector shows it. */
  name: string;
  /** Wall-clock limit in milliseconds: a positive integer. */
  timeoutMs: number;
  /** The model's text, read by the word checks. */
  modelText: string;
  /** JSON text the context parses into `__input`. */
  inputJson: string;
  /**
   * Statements that leave the result in `__result`. They may read
   * `__input`. The model's text is spliced in here by the caller.
   */
  body: string;
  /**
   * `typed`: a primitive leaves as it is (`undefined`, `NaN` and `-0`
   * included), an object as JSON, and a function or a symbol is refused.
   * `json`: one JSON round trip, where what JSON cannot carry is
   * `undefined`.
   */
  result: 'typed' | 'json';
}

/** Words the text may not hold, each with the reason given to the caller. */
const REFUSED_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bimport\b/, 'the word `import` is forbidden'],
  [/\basync\b/, 'the word `async` is forbidden: write a synchronous function, with no promise'],
];

/** The reason `code` is refused before it runs, or null. */
export function refusedWordIn(code: string): string | null {
  for (const [pattern, reason] of REFUSED_WORDS) {
    if (pattern.test(code)) return reason;
  }
  return null;
}

/** The longest message kept from a thrown value. */
const MAX_MESSAGE_CHARS = 2000;

/**
 * Source run inside the context before the model's text. It prepares the
 * context and returns the three functions the rest of the script uses,
 * each closed over the context's own untouched built-ins: `p` parses the
 * input, `e` encodes a result and `d` describes a thrown value.
 *
 * Kept to syntax every supported Node parses and to built-ins read before
 * the model's text can change them.
 */
function preludeSource(result: 'typed' | 'json'): string {
  return `(function (g, typed) {
  'use strict';
  var O = g.Object, E = g.Error, S = g.String;
  var stringify = g.JSON.stringify, parse = g.JSON.parse, same = O.is;
  var keep = {
    __proto__: null,
    Object: 1, Function: 1, Array: 1, Number: 1, Boolean: 1, String: 1, Symbol: 1, BigInt: 1,
    Date: 1, RegExp: 1, Math: 1, JSON: 1, Intl: 1, Map: 1, Set: 1, WeakMap: 1, WeakSet: 1,
    Error: 1, AggregateError: 1, EvalError: 1, RangeError: 1, ReferenceError: 1, SyntaxError: 1,
    TypeError: 1, URIError: 1, NaN: 1, Infinity: 1, undefined: 1,
    parseInt: 1, parseFloat: 1, isNaN: 1, isFinite: 1,
    encodeURI: 1, decodeURI: 1, encodeURIComponent: 1, decodeURIComponent: 1, escape: 1, unescape: 1
  };
  var names = O.getOwnPropertyNames(g), i;
  for (i = 0; i < names.length; i++) {
    if (!(names[i] in keep)) { try { delete g[names[i]]; } catch (ignored) {} }
  }
  names = O.getOwnPropertyNames(g);
  for (i = 0; i < names.length; i++) {
    if (!(names[i] in keep)) { throw new E('the context kept the global ' + names[i]); }
  }
  delete g.Array.fromAsync;
  delete g.Symbol.for;
  delete g.Symbol.keyFor;
  if ('fromAsync' in g.Array || 'for' in g.Symbol || 'keyFor' in g.Symbol) {
    throw new E('the context kept a built-in it must not hold');
  }
  O.defineProperty(E, 'stackTraceLimit', { value: undefined, writable: false, enumerable: false, configurable: false });
  O.defineProperty(E, 'prepareStackTrace', { value: undefined, writable: false, enumerable: false, configurable: false });
  O.defineProperty(E.prototype, 'code', { value: undefined, writable: true, enumerable: false, configurable: false });
  var nothing = function () {};
  g.console = O.freeze({ log: nothing, warn: nothing, error: nothing, info: nothing, debug: nothing });
  function encode(v) {
    var t = typeof v, j;
    if (!typed) {
      j = stringify(v);
      return typeof j === 'string' ? 'j' + j : 'u';
    }
    if (t === 'undefined') { return 'u'; }
    if (t === 'string') { return 's' + v; }
    if (t === 'number') { return 'n' + (same(v, -0) ? '-0' : S(v)); }
    if (t === 'boolean') { return v ? 't' : 'f'; }
    if (t === 'bigint') { return 'b' + S(v); }
    if (t === 'function') { return 'xa function'; }
    if (t === 'symbol') { return 'xa symbol'; }
    j = stringify(v);
    return typeof j === 'string' ? 'j' + j : 'xa value JSON cannot carry';
  }
  function describe(thrown) {
    var text;
    try { text = S(thrown); } catch (ignored) { text = 'a value that could not be read was thrown'; }
    return 'e' + (typeof text === 'string' ? text : 'a value that could not be read was thrown');
  }
  return { p: parse, e: encode, d: describe };
})(this, ${result === 'typed' ? 'true' : 'false'})`;
}

/** The message of a value `vm.runInContext` threw, read without running any code the context made. */
function endingOfThrown(thrown: unknown): OwnContextEnding {
  if (thrown === null || (typeof thrown !== 'object' && typeof thrown !== 'function')) {
    const text = typeof thrown === 'symbol' ? 'a symbol was thrown' : String(thrown);
    return { ended: 'threw', message: text.slice(0, MAX_MESSAGE_CHARS) };
  }
  // A Proxy answers every read through its handler, and a plain object's
  // `message` may be a getter: neither is read.
  if (types.isProxy(thrown) || !types.isNativeError(thrown)) {
    return { ended: 'threw', message: 'a value that is not an error was thrown' };
  }
  const code = Object.getOwnPropertyDescriptor(thrown, 'code');
  const message = Object.getOwnPropertyDescriptor(thrown, 'message');
  const text = message !== undefined && typeof message.value === 'string'
    ? message.value.slice(0, MAX_MESSAGE_CHARS)
    : 'an error with no readable message was thrown';
  if (code !== undefined && code.value === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
    return { ended: 'timeout', message: text };
  }
  return { ended: 'threw', message: text };
}

/** Host data from the string the context's encoder wrote. */
function decode(out: string): OwnContextEnding {
  const rest = out.slice(1);
  try {
    switch (out[0]) {
      case 'u': return { ended: 'value', value: undefined };
      case 's': return { ended: 'value', value: rest };
      case 'n': return { ended: 'value', value: Number(rest) };
      case 't': return { ended: 'value', value: true };
      case 'f': return { ended: 'value', value: false };
      case 'b': return { ended: 'value', value: BigInt(rest) };
      case 'j': return { ended: 'value', value: JSON.parse(rest) };
      case 'x': return { ended: 'refused', message: `the code returned ${rest.slice(0, MAX_MESSAGE_CHARS)}` };
      case 'e': return { ended: 'threw', message: rest.slice(0, MAX_MESSAGE_CHARS) };
      default: return { ended: 'refused', message: 'the code left no result the runner can read' };
    }
  } catch {
    return { ended: 'refused', message: 'the code left a result the runner cannot read' };
  }
}

/**
 * Run `request.body` in a context of its own and say how it ended. Never
 * throws: whatever the model's text does, and whatever Node's `vm` throws,
 * comes back as an ending.
 */
export function evaluateInOwnContext(request: OwnContextRequest): OwnContextEnding {
  const refused = refusedWordIn(request.modelText);
  if (refused !== null) return { ended: 'refused', message: refused };

  const context = vm.createContext(Object.create(null), {
    name: request.name,
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate',
  });

  const source = `const { p: __parse, e: __encode, d: __describe } = ${preludeSource(request.result)};
const __input = __parse(${JSON.stringify(request.inputJson)});
let __out;
try {
  let __result;
${request.body}
  __out = __encode(__result);
} catch (__thrown) {
  __out = __describe(__thrown);
}
__out`;

  let out: unknown;
  try {
    out = vm.runInContext(source, context, {
      timeout: request.timeoutMs,
      breakOnSigint: false,
      // With the default, Node reads and rewrites the `stack` of a value
      // the script throws, after the time limit has ended.
      displayErrors: false,
    });
  } catch (thrown) {
    return endingOfThrown(thrown);
  }
  // Anything but a primitive string is a value the context made: not read.
  if (typeof out !== 'string') {
    return { ended: 'refused', message: 'the code left no result the runner can read' };
  }
  return decode(out);
}
