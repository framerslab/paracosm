/**
 * A department report kept with its unheld effect keys dropped leaves a
 * trace where a schema fallback does.
 *
 * Since #222 a report that still names a key the run does not hold after
 * its retries keeps the rest (`salvageDepartmentReport`). The run counted
 * that call as three attempts and no fallback, emitted no event, and named
 * the dropped keys only on stdout, so the run's `schemaRetries` and the
 * dashboard's event stream could not tell a salvaged report from a clean
 * one. These tests send a department's report the way the turn loop does
 * (`sendDepartmentReport`), with the keys a Mars Genesis run holds, the
 * run's cost tracker and the stream event schema, and no model call: the
 * session replays a medical report from the live Mars pair of 8 November
 * 2026 (seed 950) with "power" in its first effect.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { StreamEventSchema } from '../../src/engine/schema/stream.js';
import { createCostTracker } from '../../src/runtime/economics/cost-tracker.js';
import { effectKeys } from '../../src/runtime/util/scenario-state.js';

const modelConfig = {
  commander: 'gpt-5.4-nano',
  departments: 'gpt-5.4-mini',
  judge: 'gpt-5.4-nano',
  director: 'gpt-5.4-mini',
  agentReactions: 'gpt-5.4-nano',
};

const state = new SimulationKernel(950, 'Aria Chen', [], { startTime: 2035, initialPopulation: 30, scenario: marsScenario }).getState();
const held = effectKeys(state, marsScenario.world).map(k => k.id);

const report = {
  department: 'medical',
  summary: 'For first landfall, an Arcadia Planitia-like ice-rich plain is the healthiest and safest option for the first permanent settlement.',
  citations: [],
  risks: [
    { severity: 'high', description: 'Mars surface radiation remains a chronic hazard; without robust shielding, cancer risk and cumulative dose will grow over time.' },
  ],
  opportunities: [],
  recommendedActions: ['Allocate construction to shielding and storm-shelter readiness.'],
  proposedPatches: {},
  forgedToolsUsed: [],
  featuredAgentUpdates: [],
  confidence: 0.8,
  openQuestions: [],
  recommendedEffects: [
    { id: 'effect_1', type: 'risk_mitigation', description: 'Land on an ice-rich plain site and immediately allocate construction to shielding and storm-shelter readiness.', systemDelta: { power: -0.05, lifeSupportCapacity: 0 }, politicsDelta: { earthDependencyPct: 0 } },
    { id: 'effect_3', type: 'social_investment', description: 'Preserve morale by avoiding a high-risk terrain choice for the first settlement.', systemDelta: { morale: 0.05 }, politicsDelta: { independencePressure: 0.02 } },
  ],
};
const reply = JSON.stringify(report);
const prose = 'The medical department recommends the ice-rich plain and shielding before anything else.';

type SendDepartmentReport = (call: {
  session: { send: (prompt: string) => Promise<{ text: string; usage?: unknown }> };
  prompt: string;
  department: string;
  site: string;
  heldKeys: readonly string[];
  recordSchemaAttempt: (schemaName: string, attempts: number, fellBack: boolean, salvaged?: boolean) => void;
  emit: (type: 'validation_fallback', data: Record<string, unknown>) => void;
  onValidationFallback?: (details: { rawText: string; schemaName?: string; err: unknown }) => void;
  log?: (line: string) => void;
}) => Promise<{ report: { summary: string; recommendedEffects: Array<{ systemDelta?: Record<string, number> }> }; fromFallback: boolean; salvaged: boolean; attempts: number; droppedKeys: string[] }>;

async function loadSend(): Promise<SendDepartmentReport> {
  const mod = await import('../../src/runtime/orchestrator/department-report.js').catch(() => ({})) as { sendDepartmentReport?: SendDepartmentReport };
  assert.equal(typeof mod.sendDepartmentReport, 'function', 'the turn loop sends a department\'s report through sendDepartmentReport, which records a salvage where a fallback is recorded');
  return mod.sendDepartmentReport!;
}

function session(replies: string[]) {
  let i = 0;
  return { send: async () => ({ text: replies[Math.min(i++, replies.length - 1)] }) };
}

test('the cost tracker counts a salvaged call apart from a fallback', () => {
  const tracker = createCostTracker(modelConfig);
  const record = tracker.recordSchemaAttempt as (schemaName: string, attempts: number, fellBack: boolean, salvaged?: boolean) => void;
  record('DepartmentReport', 1, false);
  record('DepartmentReport', 3, false, true);
  record('DepartmentReport', 3, true);
  assert.deepEqual(tracker.finalCost().schemaRetries?.DepartmentReport, { attempts: 7, calls: 3, fallbacks: 1, salvaged: 1 });
  assert.deepEqual(tracker.buildCostPayload().schemaRetries?.DepartmentReport, { attempts: 7, calls: 3, fallbacks: 1, salvaged: 1 });

  // A run with no salvage keeps the shape it had.
  const clean = createCostTracker(modelConfig);
  clean.recordSchemaAttempt('CommanderDecision', 2, false);
  assert.deepEqual(clean.finalCost().schemaRetries?.CommanderDecision, { attempts: 2, calls: 1, fallbacks: 0 });
});

test('a validation_fallback event that reports a salvage keeps its dropped keys in the stream schema', () => {
  const event = StreamEventSchema.parse({
    type: 'validation_fallback',
    leader: 'Aria Chen',
    data: {
      site: 'dept:medical:turn1:event1',
      schemaName: 'DepartmentReport',
      rawTextPreview: reply.slice(0, 1500),
      error: 'Validation failed after 3 attempts; the report was kept without the effect keys the run does not hold',
      salvaged: true,
      droppedKeys: ['power'],
    },
  });
  assert.equal(event.type, 'validation_fallback');
  const data = event.data as Record<string, unknown>;
  assert.equal(data.salvaged, true);
  assert.deepEqual(data.droppedKeys, ['power']);
});

test('a report kept with an unheld key dropped is counted as salvaged and streamed with the key', async () => {
  const sendDepartmentReport = await loadSend();
  const tracker = createCostTracker(modelConfig);
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const lines: string[] = [];
  const fallbacks: unknown[] = [];

  // The failing input of the review: [a report naming power, the same, prose].
  const result = await sendDepartmentReport({
    session: session([reply, reply, prose]),
    prompt: 'medical report',
    department: 'medical',
    site: 'dept:medical:turn1:event1',
    heldKeys: held,
    recordSchemaAttempt: tracker.recordSchemaAttempt,
    emit: (type, data) => events.push({ type, data }),
    onValidationFallback: details => fallbacks.push(details),
    log: line => lines.push(line),
  });

  assert.equal(result.fromFallback, false);
  assert.equal(result.salvaged, true);
  assert.deepEqual(result.droppedKeys, ['power']);
  assert.equal(result.report.summary, report.summary);
  assert.deepEqual(result.report.recommendedEffects[0].systemDelta, { lifeSupportCapacity: 0 });
  assert.equal(fallbacks.length, 0, 'a salvage is no fallback');

  assert.deepEqual(tracker.finalCost().schemaRetries?.DepartmentReport, { attempts: 3, calls: 1, fallbacks: 0, salvaged: 1 });
  // The server folds each run's schemaRetries into /retry-stats.
  const { aggregateSchemaRetries } = await import('../../src/server/retry-stats.js');
  const stats = aggregateSchemaRetries([tracker.finalCost().schemaRetries!]);
  assert.equal(stats.schemas.DepartmentReport.salvaged, 1);
  assert.equal(stats.schemas.DepartmentReport.fallbacks, 0);

  assert.equal(events.length, 1, JSON.stringify(events));
  const [event] = events;
  assert.equal(event.type, 'validation_fallback');
  assert.equal(event.data.site, 'dept:medical:turn1:event1');
  assert.equal(event.data.schemaName, 'DepartmentReport');
  assert.equal(event.data.salvaged, true);
  assert.deepEqual(event.data.droppedKeys, ['power']);
  assert.equal(event.data.rawTextPreview, reply, 'the preview is the reply that was kept');
  const parsed = StreamEventSchema.parse({ type: event.type, leader: 'Aria Chen', data: event.data });
  assert.deepEqual((parsed.data as Record<string, unknown>).droppedKeys, ['power']);

  assert.ok(lines.some(l => /effect keys not held, dropped: power/.test(l)), lines.join('\n'));
});

test('a report that no reply can give is still counted and reported as a fallback, with no salvage', async () => {
  const sendDepartmentReport = await loadSend();
  const tracker = createCostTracker(modelConfig);
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const fallbacks: unknown[] = [];
  const lines: string[] = [];
  const broken = JSON.stringify({ ...report, summary: '' });

  const result = await sendDepartmentReport({
    session: session([prose, broken, prose]),
    prompt: 'medical report',
    department: 'medical',
    site: 'dept:medical:turn1:event1',
    heldKeys: held,
    recordSchemaAttempt: tracker.recordSchemaAttempt,
    emit: (type, data) => events.push({ type, data }),
    onValidationFallback: details => fallbacks.push(details),
    log: line => lines.push(line),
  });

  assert.equal(result.fromFallback, true);
  assert.equal(result.salvaged, false);
  assert.deepEqual(result.droppedKeys, []);
  assert.equal(result.report.summary, 'medical report unavailable this turn.');
  assert.equal(fallbacks.length, 1);
  assert.equal(events.length, 0, 'the fallback event is the orchestrator\'s, through onValidationFallback');
  assert.deepEqual(tracker.finalCost().schemaRetries?.DepartmentReport, { attempts: 3, calls: 1, fallbacks: 1 });
  assert.ok(lines.some(l => /schema fallback; using empty report skeleton/.test(l)), lines.join('\n'));

  // The event the orchestrator emits for it carries the `error` the stream
  // schema requires; it was emitted without one.
  const mod = await import('../../src/runtime/orchestrator/department-report.js') as { validationFallbackData?: (site: string, details: unknown) => Record<string, unknown> };
  assert.equal(typeof mod.validationFallbackData, 'function');
  const data = mod.validationFallbackData!('dept:medical:turn1:event1', fallbacks[0]);
  assert.match(String(data.error), /Validation failed after 3 attempts/);
  const parsed = StreamEventSchema.safeParse({ type: 'validation_fallback', leader: 'Aria Chen', data });
  assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
  assert.equal(data.salvaged, undefined);
});
