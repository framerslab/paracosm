import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerResponse, type IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { handleListBundle, handleBundleAggregate, computeAggregate } from './bundle.js';
import { createNoopRunHistoryStore } from '../stores/run-history.js';
import type { RunRecord } from '../services/run-record.js';

function makeRes(): { res: ServerResponse; chunks: string[]; status: () => number } {
  const socket = new Socket();
  const req = { socket, headers: {}, method: 'GET', url: '/' } as unknown as IncomingMessage;
  // ServerResponse expects the raw IncomingMessage; we stub the minimum surface.
  const res = new ServerResponse(req as never);
  const chunks: string[] = [];
  let status = 0;
  res.write = ((c: string | Uint8Array) => { chunks.push(String(c)); return true; }) as never;
  res.end = ((c?: string | Uint8Array) => { if (c !== undefined) chunks.push(String(c)); return res; }) as never;
  res.writeHead = ((s: number) => { status = s; return res; }) as never;
  return { res, chunks, status: () => status };
}

const baseRecord = (overrides: Partial<RunRecord>): RunRecord => ({
  runId: 'r1',
  createdAt: '2026-04-26T00:00:00Z',
  scenarioId: 's',
  scenarioVersion: '1.0.0',
  actorConfigHash: 'h1',
  economicsProfile: 'demo',
  sourceMode: 'hosted_demo',
  createdBy: 'anonymous',
  ...overrides,
});

test('handleListBundle returns 200 with member records for valid bundleId', async () => {
  const records: RunRecord[] = [
    baseRecord({ runId: 'r1', bundleId: 'b1' }),
    baseRecord({ runId: 'r2', bundleId: 'b1', createdAt: '2026-04-26T00:00:01Z' }),
  ];
  const store = { ...createNoopRunHistoryStore(), listRunsByBundleId: async () => records };
  const { res, chunks, status } = makeRes();
  await handleListBundle('b1', res, { runHistoryStore: store });
  assert.equal(status(), 200);
  const body = JSON.parse(chunks.join(''));
  assert.equal(body.bundleId, 'b1');
  assert.equal(body.members.length, 2);
  assert.equal(body.memberCount, 2);
  assert.equal(body.scenarioId, 's');
});

test('handleListBundle returns 404 when bundle is empty', async () => {
  const store = { ...createNoopRunHistoryStore(), listRunsByBundleId: async () => [] };
  const { res, status } = makeRes();
  await handleListBundle('unknown', res, { runHistoryStore: store });
  assert.equal(status(), 404);
});

test('handleListBundle returns 501 when store does not support bundle queries', async () => {
  const baseStore = createNoopRunHistoryStore();
  const store: typeof baseStore = { ...baseStore };
  delete store.listRunsByBundleId;
  const { res, status } = makeRes();
  await handleListBundle('b1', res, { runHistoryStore: store });
  assert.equal(status(), 501);
});

test('handleBundleAggregate computes outcome buckets + cost total', async () => {
  const records: RunRecord[] = [
    baseRecord({ runId: 'r1', bundleId: 'b1', costUSD: 0.30, durationMs: 60000 }),
    baseRecord({ runId: 'r2', bundleId: 'b1', costUSD: 0.20, durationMs: 30000 }),
  ];
  const store = { ...createNoopRunHistoryStore(), listRunsByBundleId: async () => records };
  const { res, chunks, status } = makeRes();
  await handleBundleAggregate('b1', res, { runHistoryStore: store });
  assert.equal(status(), 200);
  const body = JSON.parse(chunks.join(''));
  assert.equal(body.count, 2);
  assert.equal(body.costTotalUSD, 0.50);
  assert.equal(body.meanDurationMs, 45000);
});

test('computeAggregate handles missing cost + duration gracefully', () => {
  const records: RunRecord[] = [
    baseRecord({ runId: 'r1', bundleId: 'b1' }), // no costUSD, no durationMs
    baseRecord({ runId: 'r2', bundleId: 'b1', costUSD: 0.20 }),
  ];
  const out = computeAggregate('b1', records);
  assert.equal(out.count, 2);
  assert.equal(out.costTotalUSD, 0.20);
  assert.equal(out.meanDurationMs, 0); // no durations -> 0
});
