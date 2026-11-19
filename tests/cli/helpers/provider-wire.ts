/**
 * The model providers at the wire, for tests that run the dashboard
 * server's own model calls with no network and no paid call.
 *
 * AgentOS sends every call to OpenAI, Anthropic and OpenRouter with the
 * global `fetch`. While `withProviderWire` runs, that `fetch` records each
 * request to one of them (its provider, path, model, the key it carries and
 * the text it sends) and answers it: OpenAI's model list with two models,
 * every other request with a 400 whose message says the model is
 * overloaded. On that answer AgentOS tries the next provider of the call's
 * fallback chain, when the call has one, and it does not open its provider
 * circuit breaker on a 400, so every later call of the run is sent too. The
 * run takes the answer as a failed call and goes on.
 *
 * A test may answer an OpenAI completion request with text of its own
 * (`reply`), sent back as OpenAI sends a chat completion or a Responses
 * reply, and an Anthropic one (`anthropicReply`), sent back as Anthropic
 * sends a message; every request it leaves unanswered gets the 400.
 *
 * A request to the test's own server (127.0.0.1 or localhost) goes to the
 * real `fetch`. A request to any other host answers 404 and is recorded.
 * The real `fetch` is put back however the run ends.
 */

export type WireProvider = 'openai' | 'anthropic' | 'openrouter' | 'other';

/** One request the stub received. */
export interface WireCall {
  provider: WireProvider;
  url: string;
  /** Its path, such as `/v1/chat/completions` or `/v1/messages`. */
  path: string;
  /** The model the body names, if it names one. */
  model?: string;
  /** The key it carries: OpenAI's and OpenRouter's bearer token, Anthropic's `x-api-key`. */
  key?: string;
  /** Every string in its JSON body, one a line: the system text, the messages, the instructions. */
  text: string;
  /** True when the body asks for a stream. */
  stream: boolean;
}

/** Writes the text a completion request is answered with, or undefined for the 400. */
export type WireReply = (call: WireCall) => string | undefined;

/** The message every model call is answered with. */
export const OVERLOADED = 'The stub model is overloaded.';

function providerOf(host: string): WireProvider {
  if (host === 'api.openai.com' || host.endsWith('.openai.com')) return 'openai';
  if (host === 'api.anthropic.com' || host.endsWith('.anthropic.com')) return 'anthropic';
  if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) return 'openrouter';
  return 'other';
}

function isLocal(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
}

function stringsOf(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) stringsOf(item, out);
}

function keyOf(provider: WireProvider, headers: Headers): string | undefined {
  if (provider === 'anthropic') return headers.get('x-api-key') ?? undefined;
  const auth = headers.get('authorization');
  return auth && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : undefined;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A chat completion carrying `text`, whole or as a stream, or a Responses reply, as OpenAI sends them. */
function openAiCompletion(call: WireCall, text: string): Response {
  const model = call.model ?? 'gpt-4o';
  if (call.path.endsWith('/responses')) {
    return json({
      id: 'resp-wire', object: 'response', created_at: 0, model, status: 'completed',
      output: [{ type: 'message', id: 'msg-wire', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }, 200);
  }
  const head = { id: 'chatcmpl-wire', created: 0, model };
  if (!call.stream) {
    return json({
      ...head,
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }, 200);
  }
  const chunks = [
    { ...head, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { ...head, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { ...head, object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ];
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A message carrying `text`, whole or as a stream, as Anthropic sends one. */
function anthropicMessage(call: WireCall, text: string): Response {
  const model = call.model ?? 'claude-sonnet-4-6';
  const head = { id: 'msg-wire', type: 'message', role: 'assistant', model };
  if (!call.stream) {
    return json({
      ...head,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }, 200);
  }
  const events = [
    { type: 'message_start', message: { ...head, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  const body = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function answer(call: WireCall, reply: WireReply | undefined, anthropicReply: WireReply | undefined): Response {
  if (call.provider === 'other') {
    return json({ error: { message: `the stub serves no ${call.url}` } }, 404);
  }
  if (call.provider === 'openai' && call.path.endsWith('/models')) {
    return json({ object: 'list', data: ['gpt-4o', 'gpt-4o-mini'].map(id => ({ id, object: 'model', created: 0, owned_by: 'openai' })) }, 200);
  }
  if (call.provider === 'anthropic') {
    const message = anthropicReply?.(call);
    if (message !== undefined) return anthropicMessage(call, message);
    return json({ type: 'error', error: { type: 'invalid_request_error', message: OVERLOADED } }, 400);
  }
  const text = call.provider === 'openai' ? reply?.(call) : undefined;
  if (text !== undefined) return openAiCompletion(call, text);
  return json({ error: { message: OVERLOADED, type: 'invalid_request_error', code: null } }, 400);
}

/**
 * Run `run` with the global `fetch` answering for the model providers as
 * described above. `run` is handed the record of every provider request,
 * in the order sent.
 */
export async function withProviderWire<T>(run: (calls: WireCall[]) => Promise<T>, reply?: WireReply, anthropicReply?: WireReply): Promise<T> {
  const calls: WireCall[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(url);
    if (isLocal(parsed.hostname)) return realFetch(input, init);
    const provider = providerOf(parsed.hostname);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const raw = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
    let body: Record<string, unknown> = {};
    try {
      const value: unknown = raw ? JSON.parse(raw) : {};
      if (value && typeof value === 'object' && !Array.isArray(value)) body = value as Record<string, unknown>;
    } catch {
      // A body that is not JSON is read as none.
    }
    const strings: string[] = [];
    stringsOf(body, strings);
    const call: WireCall = {
      provider,
      url,
      path: parsed.pathname,
      model: typeof body.model === 'string' ? body.model : undefined,
      key: keyOf(provider, headers),
      text: strings.join('\n'),
      stream: body.stream === true,
    };
    calls.push(call);
    return answer(call, reply, anthropicReply);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** The requests that asked a provider for a completion: every request but OpenAI's model list and other hosts. */
export function modelCalls(calls: readonly WireCall[]): WireCall[] {
  return calls.filter(c => c.provider !== 'other' && !c.path.endsWith('/models'));
}

/** The record as lines a failed test prints. */
export function describeCalls(calls: readonly WireCall[]): string {
  return calls.map((c, i) => `${i + 1}. ${c.provider} ${c.path} model=${c.model ?? '-'} key=${c.key ? 'set' : '-'} | ${JSON.stringify(c.text.slice(0, 120))}`).join('\n');
}

/**
 * Sets the host's provider keys in `process.env`, which AgentOS reads for a
 * call with no key of its own and for its default fallback chain, and
 * clears the other providers' keys that chain reads. Returns a function
 * that puts the earlier values back.
 */
export function setHostKeys(keys: { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string }): () => void {
  const names = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY'] as const;
  const before = new Map(names.map(name => [name, process.env[name]]));
  for (const name of names) {
    const value = (keys as Record<string, string | undefined>)[name];
    if (value) process.env[name] = value;
    else delete process.env[name];
  }
  return () => {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
