/**
 * A stand-in for the OpenAI API at the wire, for tests that run the real
 * compiler or the real turn loop with no network and no paid call.
 *
 * AgentOS's OpenAI provider sends every call with the global `fetch`. While
 * `withStubOpenAi` runs, that `fetch` answers the routes the provider uses:
 * the model list, a chat completion (whole or streamed) and a Responses
 * reply, each with the text a reply function writes for the request. Any
 * other path gets a 404 that names it. The real `fetch` is put back however
 * the run ends.
 *
 * The reply function is handed the whole request, read into a
 * {@link StubRequest}: a compile hook names itself in its system block, and
 * the turn loop's prompts sit in the last user message.
 */

/** One request the stub received, read for the reply function. */
export interface StubRequest {
  /** The URL fetched. */
  url: string;
  /** Its path, such as `/v1/chat/completions`. */
  path: string;
  /** The model the request names; `gpt-4o` when it names none. */
  model: string;
  /**
   * The text of every system and developer message, and of a Responses
   * request's `instructions`, joined by blank lines.
   */
  system: string;
  /** The last user message's text. */
  lastUser: string;
  /** Every message's text, and a Responses request's `instructions`, joined by blank lines. */
  text: string;
  /** The request body as sent; `{}` when it had none. */
  body: Record<string, unknown>;
}

/** A request the stub received, with what it sent back. */
export interface StubExchange extends StubRequest {
  /** The HTTP status the stub answered with. */
  status: number;
  /** The text a chat or Responses call was sent; a short note for the model list or a 404. */
  reply: string;
}

/** Writes the reply text for one chat or Responses request. */
export type StubReply = (request: StubRequest) => string;

/** The text of a chat or Responses message's content: a string, or text parts. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
      ? (part as { text: string }).text
      : '')).join('');
  }
  return '';
}

interface Message { role: string; content: unknown }

/** A chat request's `messages`, or a Responses request's `input` (a string is one user message). */
function messagesOf(body: Record<string, unknown>): Message[] {
  const list: unknown[] = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : typeof body.input === 'string'
        ? [{ role: 'user', content: body.input }]
        : [];
  return list
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map(m => ({ role: typeof m.role === 'string' ? m.role : '', content: m.content }));
}

/** Read one request for the reply function. */
function requestOf(url: string, path: string, body: Record<string, unknown>): StubRequest {
  const messages = messagesOf(body);
  const instructions = typeof body.instructions === 'string' && body.instructions ? [body.instructions] : [];
  const system = [
    ...instructions,
    ...messages.filter(m => m.role === 'system' || m.role === 'developer').map(m => textOf(m.content)),
  ].join('\n\n');
  const users = messages.filter(m => m.role === 'user');
  return {
    url,
    path,
    model: typeof body.model === 'string' ? body.model : 'gpt-4o',
    system,
    lastUser: textOf(users.at(-1)?.content),
    text: [...instructions, ...messages.map(m => textOf(m.content))].join('\n\n'),
    body,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** One chat completion, whole or as a stream, as OpenAI sends it. */
function chatCompletion(model: string, text: string, stream: boolean): Response {
  const head = { id: 'chatcmpl-stub', created: 0, model };
  if (!stream) {
    return json({
      ...head,
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }
  const chunks = [
    { ...head, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { ...head, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { ...head, object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ];
  const body = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** One Responses reply carrying `text`, as OpenAI sends it. */
function responsesReply(model: string, text: string): Response {
  return json({
    id: 'resp-stub', object: 'response', created_at: 0, model, status: 'completed',
    output: [{ type: 'message', id: 'msg-stub', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  });
}

/** A `fetch` that answers as the OpenAI API would, records each request in `seen`, and sends nothing. */
function stubFetch(reply: StubReply, seen: StubExchange[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    const raw = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : '';
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      // A body that is not JSON is read as none.
    }
    // Recorded before the reply is written, so a reply function that throws
    // still leaves the request in the record, in the order it was sent.
    const exchange: StubExchange = { ...requestOf(url, path, body), status: 0, reply: '' };
    seen.push(exchange);
    if (path.endsWith('/models')) {
      exchange.status = 200;
      exchange.reply = 'the model list';
      return json({ object: 'list', data: ['gpt-4o', 'gpt-4o-mini'].map(id => ({ id, object: 'model', created: 0, owned_by: 'openai' })) });
    }
    if (path.endsWith('/chat/completions')) {
      exchange.reply = reply(exchange);
      exchange.status = 200;
      return chatCompletion(exchange.model, exchange.reply, body.stream === true);
    }
    if (path.endsWith('/responses')) {
      exchange.reply = reply(exchange);
      exchange.status = 200;
      return responsesReply(exchange.model, exchange.reply);
    }
    const message = `the stub model serves no ${path}`;
    exchange.status = 404;
    exchange.reply = message;
    return json({ error: { message, type: 'invalid_request_error' } }, 404);
  }) as typeof fetch;
}

/**
 * Run `run` with the global `fetch` answering as the OpenAI API, each chat
 * or Responses call with the text `reply` writes for it. `run` is handed the
 * record of every request in the order sent, the model list and any 404
 * included. The real `fetch` is put back in a `finally`, on every path.
 */
export async function withStubOpenAi<T>(reply: StubReply, run: (seen: StubExchange[]) => Promise<T>): Promise<T> {
  const seen: StubExchange[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(reply, seen);
  try {
    return await run(seen);
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** True for a path the stub answers with a reply: the model list, a chat completion or a Responses reply. */
export function isServedPath(path: string): boolean {
  return path.endsWith('/models') || path.endsWith('/chat/completions') || path.endsWith('/responses');
}

/**
 * The record as lines a failed test prints: for each request, its status
 * and path, the first 200 characters of its system text (of its last user
 * message when it has none) and the first 200 of the reply it was sent.
 */
export function describeExchanges(seen: readonly StubExchange[]): string {
  return seen.map((e, i) => {
    const prompt = e.system ? `system ${JSON.stringify(e.system.slice(0, 200))}` : `user ${JSON.stringify(e.lastUser.slice(0, 200))}`;
    return `${i + 1}. ${e.status} ${e.path} | ${prompt} | reply ${JSON.stringify(e.reply.slice(0, 200))}`;
  }).join('\n');
}

/** An error for a run that failed on the stub, carrying every request it made and the reply each was sent. */
export function stubFailure(what: string, err: unknown, seen: readonly StubExchange[]): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`${what} failed: ${message}\nThe stub model received ${seen.length} requests, in order:\n${describeExchanges(seen)}`, { cause: err });
}
