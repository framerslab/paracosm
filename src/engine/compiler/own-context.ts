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
 *   checks only. A function is never returned and never called. A caller
 *   may set a limit on that string's size (`maxResultBytes`), checked
 *   before the host decodes it.
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
 * Code that reaches a deleted built-in throws where it reaches it.
 * {@link removedBuiltInNamedIn} says, before anything runs, whether a text
 * names one; the compiler asks it before it keeps or restores a hook.
 *
 * @module paracosm/engine/compiler/own-context
 */
import * as vm from 'node:vm';
import { Buffer } from 'node:buffer';
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
  | { ended: 'refused'; message: string }
  /** The result, as the context encoded it, is larger than `maxResultBytes`. */
  | { ended: 'too_large'; bytes: number; message: string };

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
  /**
   * With `result: 'typed'`, a number inside an object leaves as it is
   * too: `NaN`, `Infinity`, `-Infinity` and `-0` come back as those
   * numbers, where JSON would write `null` or `0`.
   */
  exactNumbers?: boolean;
  /**
   * The most the encoded result may be, in bytes of UTF-8. A larger one
   * ends as `too_large` and is not decoded. No limit when absent.
   */
  maxResultBytes?: number;
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
 * With `exact`, an object is encoded with the numbers JSON cannot write
 * tagged as strings that begin with U+0000 (`\u0000NaN`, `\u0000Infinity`,
 * `\u0000-Infinity`, `\u0000-0`), and a string of the result that begins
 * with U+0000 gets a second one, so a tag is never a string the code
 * wrote. {@link reviveNumbers} reads the tags back.
 *
 * Kept to syntax every supported Node parses and to built-ins read before
 * the model's text can change them.
 */
function preludeSource(result: 'typed' | 'json', exactNumbers: boolean): string {
  return `(function (g, typed, exact) {
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
  function tagNumbers(key, x) {
    if (typeof x === 'number') {
      if (x !== x) { return '\\u0000NaN'; }
      if (x === 1 / 0) { return '\\u0000Infinity'; }
      if (x === -1 / 0) { return '\\u0000-Infinity'; }
      if (x === 0 && same(x, -0)) { return '\\u0000-0'; }
      return x;
    }
    if (typeof x === 'string' && x.length > 0 && x[0] === '\\u0000') { return '\\u0000' + x; }
    return x;
  }
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
    if (exact) {
      j = stringify(v, tagNumbers);
      return typeof j === 'string' ? 'k' + j : 'xa value JSON cannot carry';
    }
    j = stringify(v);
    return typeof j === 'string' ? 'j' + j : 'xa value JSON cannot carry';
  }
  function describe(thrown) {
    var text;
    try { text = S(thrown); } catch (ignored) { text = 'a value that could not be read was thrown'; }
    return 'e' + (typeof text === 'string' ? text : 'a value that could not be read was thrown');
  }
  return { p: parse, e: encode, d: describe };
})(this, ${result === 'typed' ? 'true' : 'false'}, ${exactNumbers ? 'true' : 'false'})`;
}

/**
 * A `JSON.parse` reviver for the text an `exact` encoder wrote: a tagged
 * string reads as the number it stands for, and a string with a second
 * U+0000 as the string the code wrote. Host code, run on host data.
 */
function reviveNumbers(_key: string, value: unknown): unknown {
  if (typeof value !== 'string' || value.charCodeAt(0) !== 0) return value;
  const rest = value.slice(1);
  if (rest.charCodeAt(0) === 0) return rest;
  switch (rest) {
    case 'NaN': return Number.NaN;
    case 'Infinity': return Number.POSITIVE_INFINITY;
    case '-Infinity': return Number.NEGATIVE_INFINITY;
    case '-0': return -0;
    default: throw new Error('a tag the encoder does not write');
  }
}

/** The options every context here is made with. */
const CONTEXT_OPTIONS = { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' } as const;

/**
 * Source that lists, as JSON text, every own name of the global object
 * with the own names of what it holds (none for a primitive). Run before
 * and after the prelude, it shows what the prelude took out.
 */
const LISTING_SOURCE = `(function (g) {
  var O = g.Object, names = O.getOwnPropertyNames(g), out = [], i, v;
  for (i = 0; i < names.length; i++) {
    v = g[names[i]];
    out.push([names[i], (typeof v === 'function' || (typeof v === 'object' && v !== null)) ? O.getOwnPropertyNames(v) : []]);
  }
  return g.JSON.stringify(out);
})(this)`;

/** A pattern that finds `name` where code names it: as a word of its own, not as a property after a dot. */
function namedAsCode(name: string): RegExp {
  const words = name.split('.').map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // `a.Proxy` is a property of `a`; `...Proxy` spreads the global.
  return new RegExp(`(?<![\\w$])(?<!(?<!\\.\\.)\\.)${words.join('\\s*\\??\\.\\s*')}(?![\\w$])`);
}

let removedPatterns: ReadonlyArray<readonly [RegExp, string]> | null = null;

/**
 * What the prelude takes out of a context, each with the pattern that
 * finds it in code: every global a new context holds and a prepared one
 * does not (`Promise`, `Float64Array`), and every member one of the kept
 * globals loses (`Symbol.for`, `Array.fromAsync`, `console.table`).
 *
 * Read from a context, not written down a second time: the names are
 * listed in a new context, the prelude runs there, and they are listed
 * again. So the answer is the prelude's own, on the Node that runs it.
 * No model's text is in that context, and what comes out is two strings.
 */
function removedBuiltIns(): ReadonlyArray<readonly [RegExp, string]> {
  if (removedPatterns !== null) return removedPatterns;
  const context = vm.createContext(Object.create(null), { name: 'paracosm-own-context-listing', ...CONTEXT_OPTIONS });
  const run = (source: string): unknown => vm.runInContext(source, context, { timeout: 1000, displayErrors: false });
  const list = (): Map<string, Set<string>> => {
    const pairs = JSON.parse(String(run(LISTING_SOURCE))) as Array<[string, string[]]>;
    return new Map(pairs.map(([name, members]): [string, Set<string>] => [name, new Set(members)]));
  };
  const before = list();
  run(`${preludeSource('json', false)};`);
  const after = list();
  const removed: string[] = [];
  for (const [name, members] of before) {
    const kept = after.get(name);
    if (kept === undefined) {
      removed.push(name);
      continue;
    }
    for (const member of members) {
      if (!kept.has(member)) removed.push(`${name}.${member}`);
    }
  }
  const patterns = removed.map((name): readonly [RegExp, string] => [namedAsCode(name), name]);
  removedPatterns = patterns;
  return patterns;
}

/** The words whose parenthesis is the head of a statement. `a.if(b)` calls a member named `if`. */
const STATEMENT_HEAD = /(?:^|[^\w$.])(?:if|while|for|with)$/;

/** The word whose parenthesis is the head of a `for`. */
const FOR_HEAD = /(?:^|[^\w$.])for$/;

/**
 * What stands in the head of a for-of before its `of`: the name or the
 * pattern the loop binds, after `const`, `let` or `var` if one is there.
 */
const FOR_OF_BINDING = /^\s*(?:(?:const|let|var)\s+)?(?:[A-Za-z_$][\w$]*|[[{][\s\S]*[\]}])\s*$/;

/**
 * The place in `text` of the `(` that is open at `end`, the innermost
 * one, or -1. `text` is scanned code, with its strings, comments and
 * patterns blank, so every parenthesis in it is code.
 */
function openParenthesis(text: string, end: number): number {
  let depth = 0;
  for (let k = end - 1; k >= 0; k -= 1) {
    if (text[k] === ')') {
      depth += 1;
    } else if (text[k] === '(') {
      if (depth === 0) return k;
      depth -= 1;
    }
  }
  return -1;
}

/** True where the word `word` finds stands right before the place `at` of `text`. */
function wordBefore(text: string, at: number, word: RegExp): boolean {
  let end = at;
  while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  return word.test(text.slice(Math.max(0, end - 6), end));
}

/**
 * True where a `/` after `before` starts a regular expression and not a
 * division. It starts one after a sign that a value follows, and after a
 * word that a value follows (`return`, `typeof`, `yield` and the like);
 * after a name or a number it divides. Three cases need more than the
 * sign or the word before the slash:
 *
 * - After a `)`: a statement follows the head of an `if`, a `while`, a
 *   `for` or a `with`, so a slash there opens a pattern; after any other
 *   `)` it divides.
 * - After `of`: a keyword in the head of a `for` where it follows what
 *   the loop binds (`for (const m of /a/.exec(s))`), and a pattern may
 *   follow it there. Anywhere else it is a name, which a slash divides:
 *   outside a `for`, and in the condition of one (`for (; of / 2; )`).
 * - After `++` or `--`: the sign stands after the value it changes
 *   (`n++ / 2`), so a slash there divides.
 *
 * `yield` is a word here and never a name: a hook is parsed as strict
 * code (source-validation.ts), where no variable has that name.
 *
 * What it does not tell apart: a slash after the `}` that ends an object
 * or a function written as a value, and a slash after a string, a
 * template or a pattern, are read as the start of a pattern, by the sign
 * that stands before them. Code that divides one of those is then read
 * without the rest of its line up to the next slash.
 */
function startsRegex(before: string): boolean {
  const text = before.trimEnd();
  if (text === '') return true;
  if (text.endsWith(')')) {
    const open = openParenthesis(text, text.length - 1);
    return open !== -1 && wordBefore(text, open, STATEMENT_HEAD);
  }
  // `n++` and `n--` end a value. A run of three is that and a sign of its own: `n++ +`.
  const signs = /(?:\++|-+)$/.exec(text);
  if (signs !== null && signs[0].length % 2 === 0) return false;
  if (/[(,=:[!&|?{};+\-*%<>~^]$/.test(text)) return true;
  if (/(?:^|[^\w$.])of$/.test(text.slice(-3))) {
    const open = openParenthesis(text, text.length);
    return open !== -1 && wordBefore(text, open, FOR_HEAD) && FOR_OF_BINDING.test(text.slice(open + 1, text.length - 2));
  }
  return /(?:^|[^\w$.])(?:return|typeof|case|in|delete|void|throw|new|else|do|instanceof|yield)$/.test(text.slice(-12));
}

/**
 * A member written in brackets with its name as a string, `Symbol['for']`,
 * is the member written after a dot, `Symbol.for`. Where the string that
 * runs from `start` to `end` in `code` is such a name, this gives the
 * scanned text `out` with the member written the second way and the place
 * the scan goes on from; else null.
 */
function memberInBrackets(out: string, code: string, start: number, end: number): { out: string; next: number } | null {
  if (code[end] !== code[start]) return null;
  const name = code.slice(start + 1, end);
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  let close = end + 1;
  while (close < code.length && /\s/.test(code[close])) close += 1;
  if (code[close] !== ']') return null;
  const open = out.trimEnd();
  if (!open.endsWith('[')) return null;
  const object = open.slice(0, -1).trimEnd();
  if (object.endsWith('?.')) return { out: `${object}${name}`, next: close + 1 };
  // A bracket after a name, a call or another member reads a member of it; any other bracket opens an array.
  if (!/[\w$)\]]$/.test(object)) return null;
  return { out: `${object}.${name}`, next: close + 1 };
}

/**
 * `code` with the text of its comments, string literals, template
 * literals and regular expression literals replaced by spaces, so a check
 * for a name reads code only. The code inside a template's `${ }` stays,
 * and a member written in brackets with its name as a string is written
 * after a dot ({@link memberInBrackets}).
 * A scanner and not a parser: it tells a regular expression from a
 * division by what stands before the slash, and after a `)` by what that
 * parenthesis closes.
 */
function codeOnly(code: string): string {
  let out = '';
  let i = 0;
  // One entry for each open template literal: the braces open inside its current `${ }`.
  const templates: number[] = [];
  const blank = (to: number): void => {
    const end = Math.min(code.length, to);
    out += code.slice(i, end).replace(/[^\n]/g, ' ');
    i = end;
  };
  /**
   * Blank a template's text from `i` to its closing backtick, or to the
   * `${` that opens code. The code of a `${ }` is an expression of its
   * own, so it is written here in parentheses: what stands before the
   * `${`, the code of the `${ }` before it for one, is then not read as
   * the start of that expression.
   */
  const templateText = (): void => {
    let j = i;
    let opensCode = false;
    while (j < code.length) {
      if (code[j] === '\\') { j += 2; continue; }
      if (code[j] === '`') { templates.pop(); j += 1; break; }
      if (code[j] === '$' && code[j + 1] === '{') { templates[templates.length - 1] = 0; j += 2; opensCode = true; break; }
      j += 1;
    }
    blank(j);
    if (opensCode) out = `${out.slice(0, -1)}(`;
  };
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (ch === '/' && next === '/') {
      const end = code.indexOf('\n', i);
      blank(end === -1 ? code.length : end);
    } else if (ch === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      blank(end === -1 ? code.length : end + 2);
    } else if (ch === '\'' || ch === '"') {
      let j = i + 1;
      while (j < code.length && code[j] !== ch && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
      const member = memberInBrackets(out, code, i, j);
      if (member === null) {
        blank(j + 1);
      } else {
        out = member.out;
        i = member.next;
      }
    } else if (ch === '`') {
      templates.push(0);
      out += ' ';
      i += 1;
      templateText();
    } else if (ch === '/' && startsRegex(out)) {
      let j = i + 1;
      let inClass = false;
      while (j < code.length && code[j] !== '\n' && (inClass || code[j] !== '/')) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === '[') inClass = true;
        else if (code[j] === ']') inClass = false;
        j += 1;
      }
      j += 1;
      while (j < code.length && /[a-z]/i.test(code[j])) j += 1;
      blank(j);
    } else if (templates.length > 0 && ch === '{') {
      templates[templates.length - 1] += 1;
      out += ch;
      i += 1;
    } else if (templates.length > 0 && ch === '}') {
      if (templates[templates.length - 1] === 0) {
        out += ')';
        i += 1;
        templateText();
      } else {
        templates[templates.length - 1] -= 1;
        out += ch;
        i += 1;
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * The first built-in `code` names that the context does not hold, such as
 * `Float64Array` or `Symbol.for`, or null.
 *
 * Code that reaches one throws at that point, at whatever call first
 * takes that path, so a text that names one is not kept. A name in a
 * string, a template's text, a regular expression or a comment is not
 * read. What is read is the name, not whether a call reaches it: a text
 * that names one as a variable of its own, as an object key, or on a path
 * no call takes is answered the same way.
 *
 * A member is read where its name is written: after a dot, or in brackets
 * as a string (`Symbol['for']`). A built-in the code reaches without
 * writing its name, through a key it computes for example, is not found.
 * That text is kept, and it throws at the call that reaches the built-in.
 */
export function removedBuiltInNamedIn(code: string): string | null {
  // A model's answer may come wrapped in a Markdown code fence, and the
  // hook cache keeps it that way; the fence is not part of the code.
  const text = codeOnly(code.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, ''));
  for (const [pattern, name] of removedBuiltIns()) {
    if (pattern.test(text)) return name;
  }
  return null;
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
      case 'k': return { ended: 'value', value: JSON.parse(rest, reviveNumbers) };
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

  const context = vm.createContext(Object.create(null), { name: request.name, ...CONTEXT_OPTIONS });

  const source = `const { p: __parse, e: __encode, d: __describe } = ${preludeSource(request.result, request.result === 'typed' && request.exactNumbers === true)};
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
  // A returned value is measured before the host decodes it; the first
  // character is the encoder's tag.
  if (request.maxResultBytes !== undefined && out[0] !== 'e' && out[0] !== 'x') {
    const bytes = Buffer.byteLength(out, 'utf8') - 1;
    if (bytes > request.maxResultBytes) {
      return {
        ended: 'too_large',
        bytes,
        message: `the result is ${bytes} bytes, over the limit of ${request.maxResultBytes}`,
      };
    }
  }
  return decode(out);
}
