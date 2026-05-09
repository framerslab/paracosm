import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompileLog,
  buildResearchLog,
  buildActorsLog,
  buildRunningLog,
  buildLogForStage,
  formatStageDuration,
  formatTs,
  type BuildLogContext,
} from './QuickstartStageLog.helpers.js';
import type { SimEvent } from '../../hooks/useSSE.js';
import type { Stage } from './QuickstartProgress.js';

const T0 = 1_700_000_000_000;

function ctx(overrides: Partial<BuildLogContext> = {}): BuildLogContext {
  return {
    stage: 'compile',
    startMs: T0,
    phaseTransitionMs: { compile: T0 },
    actorCount: 3,
    events: [],
    ...overrides,
  };
}

test('formatTs: zero renders as 0:00.0', () => {
  assert.equal(formatTs(0), '0:00.0');
});

test('formatTs: sub-second offset rounds tenths', () => {
  assert.equal(formatTs(450), '0:00.4');
});

test('formatTs: seconds + tenths', () => {
  assert.equal(formatTs(12_300), '0:12.3');
});

test('formatTs: minute boundary', () => {
  assert.equal(formatTs(63_000), '1:03.0');
});

test('formatTs: negative input clamps to zero', () => {
  assert.equal(formatTs(-50), '0:00.0');
});

test('buildCompileLog: emits dispatch line during compile', () => {
  const lines = buildCompileLog(ctx({ stage: 'compile' }));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].tone, 'active');
  assert.match(lines[0].body, /compile-from-seed/);
});

test('buildCompileLog: adds OK line once research has fired', () => {
  const lines = buildCompileLog(ctx({
    stage: 'research',
    phaseTransitionMs: { compile: T0, research: T0 + 12_300 },
  }));
  assert.equal(lines.length, 2);
  assert.equal(lines[1].tone, 'done');
  assert.equal(lines[1].ts, '0:12.3');
});

test('buildResearchLog: empty until research fires', () => {
  assert.deepEqual(buildResearchLog(ctx({ stage: 'compile' })), []);
});

test('buildResearchLog: fallback note when no groundingSummary', () => {
  const lines = buildResearchLog(ctx({
    stage: 'research',
    phaseTransitionMs: { compile: T0, research: T0 + 5_000 },
  }));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].tone, 'active');
  assert.match(lines[0].body, /Grounding scenario with web research/);
});

test('buildResearchLog: skipped surfaces a single warn line with reason', () => {
  const lines = buildResearchLog(ctx({
    stage: 'research',
    phaseTransitionMs: { compile: T0, research: T0 + 100 },
    groundingSummary: { skipped: true, reason: 'SERPER_API_KEY not configured' },
  }));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].tone, 'warn');
  assert.equal(lines[0].tag, 'SKIP');
  assert.match(lines[0].body, /SERPER_API_KEY not configured/);
});

test('buildResearchLog: real citations render dispatch + per-query + per-source + summary lines', () => {
  const lines = buildResearchLog(ctx({
    stage: 'research',
    phaseTransitionMs: { compile: T0, research: T0 + 100, actors: T0 + 4_500 },
    groundingSummary: {
      citations: [
        {
          query: 'hurricane evacuation',
          sources: [
            { title: 'NHC Hurricane Prep Guide', link: 'https://nhc.noaa.gov/prepare', domain: 'nhc.noaa.gov', provider: 'serper' },
            { title: 'Coastal Evacuation Best Practices', link: 'https://fema.gov/evac', domain: 'fema.gov', provider: 'tavily' },
          ],
        },
        {
          query: 'storm surge response',
          sources: [
            { title: 'Storm Surge Modeling 2024', link: 'https://noaa.gov/surge', domain: 'noaa.gov', provider: 'serper' },
          ],
        },
      ],
      totalSources: 3,
      durationMs: 4400,
      providersUsed: ['serper', 'tavily'],
      providersFailed: [],
    },
  }));
  // dispatch + 2 query buckets + 3 source rows + 1 summary = 7 lines.
  assert.equal(lines.length, 7);
  assert.equal(lines[0].tag, 'POST');
  assert.match(lines[0].body, /2 queries/);
  assert.match(lines[0].body, /serper \+ tavily/);
  assert.equal(lines[1].tag, 'QUERY');
  // Provider tag now drives the source tag, not the domain.
  assert.equal(lines[2].tag, 'SERPER');
  assert.equal(lines[3].tag, 'TAVILY');
  assert.equal(lines[lines.length - 1].tone, 'done');
  assert.match(lines[lines.length - 1].body, /3 unique sources attached/);
  assert.match(lines[lines.length - 1].body, /4\.4s/);
});

test('buildResearchLog: failed providers surface as warn lines', () => {
  const lines = buildResearchLog(ctx({
    stage: 'research',
    phaseTransitionMs: { compile: T0, research: T0 + 100 },
    groundingSummary: {
      citations: [{
        query: 'q',
        sources: [{ title: 'A', link: 'https://a/x', domain: 'a', provider: 'serper' }],
      }],
      totalSources: 1,
      durationMs: 1000,
      providersUsed: ['serper'],
      providersFailed: [{ provider: 'firecrawl', reason: 'Firecrawl HTTP 402: Insufficient credits' }],
    },
  }));
  const warnLine = lines.find((l) => l.tone === 'warn');
  assert.ok(warnLine, 'firecrawl failure should appear as a warn line');
  assert.equal(warnLine?.tag, 'FIRECRAW');
  assert.match(warnLine?.body ?? '', /Insufficient credits/);
});

test('buildActorsLog: dispatch + OK lines once next stage starts', () => {
  const lines = buildActorsLog(ctx({
    stage: 'running',
    actorCount: 4,
    phaseTransitionMs: { compile: T0, research: T0 + 1_000, actors: T0 + 1_500, running: T0 + 9_500 },
  }));
  assert.equal(lines.length, 2);
  assert.match(lines[0].body, /count=4/);
  assert.match(lines[1].body, /4 actors generated/);
});

test('buildActorsLog: singular copy when actorCount is 1', () => {
  const lines = buildActorsLog(ctx({
    stage: 'running',
    actorCount: 1,
    phaseTransitionMs: { compile: T0, research: T0, actors: T0 + 100, running: T0 + 200 },
  }));
  assert.match(lines[1].body, /1 actor generated/);
});

test('buildRunningLog: maps SSE events to log lines, dropping status', () => {
  const events: SimEvent[] = [
    { type: 'status', leader: 'A', data: { status: 'connected' } },
    { type: 'turn_start', leader: 'Mayor', turn: 0, data: { summary: 'kickoff' } },
    { type: 'specialist_done', leader: 'Mayor', turn: 0, data: { department: 'public-safety' } },
    { type: 'turn_done', leader: 'Mayor', turn: 0 },
  ];
  const lines = buildRunningLog(ctx({ stage: 'running', events }));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].tag, 'TURN');
  assert.equal(lines[0].body, 'kickoff');
  assert.equal(lines[1].body, 'public-safety');
  assert.equal(lines[2].glyph, '✓');
});

test('buildRunningLog: turn-based ts column', () => {
  const events: SimEvent[] = [
    { type: 'decision_made', leader: 'A', turn: 3, data: { summary: 'evac' } },
    { type: 'outcome', leader: 'A', data: { summary: 'no turn field', turn: 5 } },
  ];
  const lines = buildRunningLog(ctx({ events }));
  assert.equal(lines[0].ts, 'T3');
  assert.equal(lines[1].ts, 'T5');
});

test('buildRunningLog: events with no useful summary still render type', () => {
  const events: SimEvent[] = [
    { type: 'bulletin', leader: 'A', turn: 1, data: {} },
  ];
  const lines = buildRunningLog(ctx({ events }));
  assert.equal(lines.length, 1);
  assert.match(lines[0].body, /bulletin fired/);
});

test('buildLogForStage: routes to correct builder', () => {
  const c = ctx({ stage: 'compile' });
  assert.deepEqual(buildLogForStage('compile', c), buildCompileLog(c));
  assert.deepEqual(buildLogForStage('research', c), buildResearchLog(c));
  assert.deepEqual(buildLogForStage('actors', c), buildActorsLog(c));
  assert.deepEqual(buildLogForStage('running', c), buildRunningLog(c));
  assert.deepEqual(buildLogForStage('done', c), []);
});

test('formatStageDuration: blank when stage has not started', () => {
  assert.equal(formatStageDuration('actors', ctx()), '');
});

test('formatStageDuration: sub-second renders ms', () => {
  const c = ctx({
    phaseTransitionMs: { compile: T0, research: T0 + 250 },
  });
  assert.equal(formatStageDuration('compile', c), '250ms');
});

test('formatStageDuration: 1-9.9s renders one decimal', () => {
  const c = ctx({
    phaseTransitionMs: { compile: T0, research: T0 + 4_700 },
  });
  assert.equal(formatStageDuration('compile', c), '4.7s');
});

test('formatStageDuration: 10s+ rounds to whole seconds', () => {
  const c = ctx({
    phaseTransitionMs: { compile: T0, research: T0 + 23_400 },
  });
  assert.equal(formatStageDuration('compile', c), '23s');
});

test('formatStageDuration: in-progress stage uses Date.now() as endpoint', () => {
  const c = ctx({
    phaseTransitionMs: { compile: Date.now() - 1_500 },
  });
  // Should be ≈ 1.5s; allow ±0.4s for the test boundary.
  const out = formatStageDuration('compile', c);
  const match = out.match(/^([\d.]+)s$/);
  assert.ok(match, `expected "Xs" formatting, got ${out}`);
  const sec = Number(match[1]);
  assert.ok(sec >= 1.0 && sec <= 2.5, `expected ~1.5s, got ${sec}`);
});

const stages: Stage[] = ['compile', 'research', 'actors', 'running', 'done'];
test('buildLogForStage: every Stage value handled (exhaustive)', () => {
  for (const s of stages) {
    const out = buildLogForStage(s, ctx({ stage: s }));
    assert.ok(Array.isArray(out), `stage ${s} should return an array`);
  }
});
