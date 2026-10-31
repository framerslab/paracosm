/**
 * Child process for tests/cli/server-disconnect-watchdog.test.ts. It
 * starts a run on a real server (the pair runner stubbed, so no model is
 * called), opens /events and drops it so the disconnect watchdog arms,
 * closes the server and prints "fixture: server closed". The parent
 * test then checks that this process exits on its own instead of
 * waiting out the grace.
 */
import { once } from 'node:events';
import { createMarsServer } from '../../../src/server/server-app.js';

/** Delays of every setTimeout the server sets, so the watchdog's arming can be seen. */
const delays: number[] = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
  delays.push(ms ?? 0);
  return realSetTimeout(fn, ms, ...rest);
}) as typeof setTimeout;

async function waitUntil(pred: () => boolean, label: string) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > 10_000) throw new Error(`timed out waiting for ${label}`);
    await new Promise(r => setImmediate(r));
  }
}

const hexaco = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 };
let runStarted = false;
const server = createMarsServer({
  env: { ...process.env },
  maxSimsPerDay: 0,
  runPairSimulations: async (_config: unknown, _broadcast: unknown, signal: AbortSignal) => {
    runStarted = true;
    await new Promise(r => signal.addEventListener('abort', r, { once: true }));
  },
} as any);
server.listen(0);
await once(server, 'listening');
const port = (server.address() as { port: number }).port;

const setupRes = await fetch(`http://127.0.0.1:${port}/setup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    actors: [
      { name: 'Aria Chen', archetype: 'The Visionary', colony: 'Ares Horizon', hexaco, instructions: 'Leader A' },
      { name: 'Dietrich Voss', archetype: 'The Engineer', colony: 'Meridian Base', hexaco, instructions: 'Leader B' },
    ],
    provider: 'anthropic',
    turns: 1,
    startTime: 2042,
    population: 110,
    activeDepartments: ['medical', 'engineering', 'governance'],
    execution: { commanderMaxSteps: 7, departmentMaxSteps: 11, sandboxTimeoutMs: 15000, sandboxMemoryMB: 256 },
    models: { commander: 'gpt-5.4', departments: 'gpt-5.4-mini', judge: 'gpt-5.4' },
  }),
});
if (!setupRes.ok) throw new Error(`setup failed: ${setupRes.status} ${await setupRes.text()}`);
await waitUntil(() => runStarted, 'the run to start');

const stream = new AbortController();
const res = await fetch(`http://127.0.0.1:${port}/events`, { signal: stream.signal });
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let text = '';
while (!text.includes('event: replay_done')) {
  const { value, done } = await reader.read();
  if (done) break;
  text += decoder.decode(value);
}
if (!text.includes('event: replay_done')) throw new Error(`no replay_done: ${text}`);
stream.abort();
await waitUntil(() => delays.some(d => d >= 30_000), 'the watchdog to arm');

server.closeAllConnections?.();
server.close();
await once(server, 'close');
console.log('fixture: server closed');
