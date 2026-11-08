import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DepartmentReportSchema,
  RiskSchema,
  OpportunitySchema,
  ForgedToolUsageSchema,
  RecommendedEffectSchema,
} from './department.js';

const validReport = {
  department: 'medical',
  summary: 'Radiation exposure is trending up; 3 near-threshold cases.',
  citations: [{ text: 'NASA HRP', url: 'https://example.com/hrp', context: 'dose study' }],
  risks: [{ severity: 'high', description: 'two crew near annual limit' }],
  opportunities: [],
  recommendedActions: ['Increase shielding on crew quarters'],
  proposedPatches: {},
  forgedToolsUsed: [],
  featuredAgentUpdates: [],
  confidence: 0.85,
  openQuestions: [],
  recommendedEffects: [],
};

test('DepartmentReportSchema accepts valid report', () => {
  assert.equal(DepartmentReportSchema.safeParse(validReport).success, true);
});

test('RiskSchema rejects out-of-domain severity', () => {
  assert.equal(RiskSchema.safeParse({ severity: 'catastrophic', description: 'x' }).success, false);
});

test('RiskSchema accepts all four severities', () => {
  for (const sev of ['low', 'medium', 'high', 'critical']) {
    assert.equal(RiskSchema.safeParse({ severity: sev, description: 'x' }).success, true);
  }
});

test('OpportunitySchema rejects out-of-domain impact', () => {
  assert.equal(OpportunitySchema.safeParse({ impact: 'massive', description: 'x' }).success, false);
});

test('ForgedToolUsageSchema rejects out-of-domain mode', () => {
  const bad = { name: 't', mode: 'script', description: 'x', output: {}, confidence: 0.5 };
  assert.equal(ForgedToolUsageSchema.safeParse(bad).success, false);
});

test('RecommendedEffectSchema rejects out-of-domain type', () => {
  const bad = { id: 'e1', type: 'magic', description: 'x' };
  assert.equal(RecommendedEffectSchema.safeParse(bad).success, false);
});

test('DepartmentReportSchema fills defaults when arrays omitted', () => {
  const minimal = {
    department: 'medical',
    summary: 'x',
    confidence: 0.7,
  };
  const result = DepartmentReportSchema.safeParse(minimal);
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.citations, []);
    assert.deepEqual(result.data.risks, []);
    assert.deepEqual(result.data.recommendedActions, []);
    assert.deepEqual(result.data.proposedPatches, {});
  }
});

test('DepartmentReportSchema rejects confidence out of [0,1]', () => {
  const bad = { ...validReport, confidence: 1.5 };
  assert.equal(DepartmentReportSchema.safeParse(bad).success, false);
});

test('DepartmentReportSchema rejects empty department string', () => {
  const bad = { ...validReport, department: '' };
  assert.equal(DepartmentReportSchema.safeParse(bad).success, false);
});

/**
 * A report's effect keys are the run's own. In the live Mars Genesis pair
 * of 6 November 2026, 31 of Aria Chen's 55 selected delta keys named
 * nothing the run holds ("power", "water", "waterReliability") and moved
 * nothing. The schema a run validates its department reports with refuses
 * such a key and names the keys the run holds, so the retry prompt
 * (sendAndValidate) tells the model what to write instead.
 */
test('a report schema built for a Mars run refuses a key the run does not hold and names the held keys', async () => {
  const validators = await import('./department.js') as Record<string, unknown>;
  const schemaFor = validators.departmentReportSchemaFor as
    ((held: readonly string[]) => typeof DepartmentReportSchema) | undefined;
  assert.equal(typeof schemaFor, 'function', 'department.ts builds a report schema for the keys a run holds');

  const { SimulationKernel } = await import('../../engine/core/kernel.js');
  const { marsScenario } = await import('../../engine/scenarios/index.js');
  const state = new SimulationKernel(950, 'Aria Chen', [], { startTime: 2035, initialPopulation: 30, scenario: marsScenario }).getState();
  const held = Object.entries({ ...state.metrics, ...state.politics })
    .filter(([, v]) => typeof v === 'number')
    .map(([k]) => k);
  assert.ok(held.includes('infrastructureModules') && held.includes('earthDependencyPct'), held.join(', '));
  const schema = schemaFor!(held);

  // Aria Chen's turn 2: engineering effect_3 and agriculture effect_1.
  const refused = schema.safeParse({
    ...validReport,
    department: 'engineering',
    recommendedEffects: [
      { id: 'effect_3', type: 'resource_shift', description: 'Shift power to the filters.', systemDelta: { power: -0.05, water: 0.03 } },
      { id: 'effect_1', type: 'risk_mitigation', description: 'Second water loop.', systemDelta: { waterReliability: 0.08, power: -0.03 } },
    ],
  });
  assert.equal(refused.success, false, 'power, water and waterReliability are refused');
  const messages = refused.success ? '' : refused.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n');
  for (const key of ['power', 'water', 'waterReliability']) assert.match(messages, new RegExp(`"${key}"`), messages);
  for (const key of ['infrastructureModules', 'foodMonthsReserve', 'powerKw', 'lifeSupportCapacity', 'earthDependencyPct']) {
    assert.match(messages, new RegExp(`\\b${key}\\b`), `the message names ${key}:\n${messages}`);
  }

  // Held keys pass, in either bag, and a report with no effects is unchanged.
  const held2 = schema.safeParse({
    ...validReport,
    recommendedEffects: [{ id: 'effect_1', type: 'capacity_expansion', description: 'One module.', systemDelta: { infrastructureModules: 1, foodMonthsReserve: 2 }, politicsDelta: { earthDependencyPct: -3 } }],
  });
  assert.equal(held2.success, true, held2.success ? '' : JSON.stringify(held2.error.issues));
  assert.equal(schema.safeParse(validReport).success, true);
});

/**
 * A report that still names a key the run does not hold after its retries
 * keeps the rest. The orchestrator validates each department's report with
 * `departmentReportSchemaFor` and, once the retries are spent, hands the
 * last reply to `salvageDepartmentReport` (the `salvage` of
 * `sendAndValidate`), as below; before, the department's summary, risks
 * and held effects gave way to the empty report for that event.
 */
test('a report that names an unheld key on every attempt keeps the rest, with those keys dropped and logged', async () => {
  const validators = await import('./department.js') as Record<string, unknown>;
  const salvage = validators.salvageDepartmentReport as
    ((raw: unknown, held: readonly string[], log: (line: string) => void) => unknown) | undefined;
  const { sendAndValidate } = await import('../../llm/sendAndValidate.js');
  const { emptyReport } = await import('../util/parsers.js');
  const { SimulationKernel } = await import('../../engine/core/kernel.js');
  const { marsScenario } = await import('../../engine/scenarios/index.js');
  const state = new SimulationKernel(950, 'Aria Chen', [], { startTime: 2035, initialPopulation: 30, scenario: marsScenario }).getState();
  const held = Object.entries({ ...state.metrics, ...state.politics })
    .filter(([, v]) => typeof v === 'number')
    .map(([k]) => k);

  // Aria Chen's turn 1 medical report in the live Mars Genesis pair of 8
  // November 2026 (seed 950), with "power" in effect_1 as the engineering
  // department wrote it on 6 November.
  const summary = 'For first landfall, an Arcadia Planitia-like ice-rich plain is the healthiest and safest option for the first permanent settlement.';
  const reply = JSON.stringify({
    ...validReport,
    summary,
    risks: [
      { severity: 'high', description: 'Mars surface radiation remains a chronic hazard; without robust shielding, cancer risk and cumulative dose will grow over time.' },
      { severity: 'medium', description: 'Solar particle events can produce acute dose spikes; a site without nearby storm shelter capacity exposes crew to avoidable medical risk.' },
    ],
    recommendedEffects: [
      { id: 'effect_1', type: 'risk_mitigation', description: 'Land on an ice-rich plain site and immediately allocate construction to shielding and storm-shelter readiness.', systemDelta: { power: -0.05, lifeSupportCapacity: 0 }, politicsDelta: { earthDependencyPct: 0 } },
      { id: 'effect_3', type: 'social_investment', description: 'Preserve morale by avoiding a high-risk terrain choice for the first settlement and by visibly prioritizing crew safety.', systemDelta: { morale: 0.05 }, politicsDelta: { independencePressure: 0.02 } },
    ],
  });
  const prompts: string[] = [];
  const lines: string[] = [];
  const result = await sendAndValidate({
    session: { send: async (prompt: string) => { prompts.push(prompt); return { text: reply }; } },
    prompt: 'medical report',
    schema: validators.departmentReportSchemaFor ? (validators.departmentReportSchemaFor as (h: readonly string[]) => typeof DepartmentReportSchema)(held) : DepartmentReportSchema,
    schemaName: 'DepartmentReport',
    fallback: { ...emptyReport('medical'), summary: 'medical report unavailable this turn.' } as never,
    salvage: (raw: unknown) => salvage?.(raw, held, line => lines.push(line)),
  } as Parameters<typeof sendAndValidate>[0]);

  assert.equal(prompts.length, 3, 'the run still asks again twice');
  assert.match(prompts[1], /"power" is not a key this run holds/);
  assert.equal(result.fromFallback, false, `the report is kept, not the empty one: ${JSON.stringify(result.object).slice(0, 200)}`);
  const report = result.object as { summary: string; risks: unknown[]; recommendedEffects: Array<{ id: string; systemDelta?: Record<string, number>; politicsDelta?: Record<string, number> }> };
  assert.equal(report.summary, summary);
  assert.equal(report.risks.length, 2);
  assert.deepEqual(report.recommendedEffects.map(e => e.id), ['effect_1', 'effect_3']);
  assert.deepEqual(report.recommendedEffects[0].systemDelta, { lifeSupportCapacity: 0 });
  assert.deepEqual(report.recommendedEffects[0].politicsDelta, { earthDependencyPct: 0 });
  assert.deepEqual(report.recommendedEffects[1].systemDelta, { morale: 0.05 });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /effect keys not held, dropped: power \(the run holds [^)]*\binfrastructureModules\b/);

  // A reply that fails the plain schema too still gives way to the empty report.
  const broken = JSON.stringify({ ...JSON.parse(reply), summary: '' });
  const fellBack = await sendAndValidate({
    session: { send: async () => ({ text: broken }) },
    prompt: 'medical report',
    schema: DepartmentReportSchema,
    fallback: { ...emptyReport('medical'), summary: 'medical report unavailable this turn.' } as never,
    salvage: (raw: unknown) => salvage?.(raw, held, () => {}),
  } as Parameters<typeof sendAndValidate>[0]);
  assert.equal(fellBack.fromFallback, true);
  assert.equal((fellBack.object as { summary: string }).summary, 'medical report unavailable this turn.');
});

test('an unheld key a model wrote with a line break is named on the one salvage line', async () => {
  // The dropped keys are the model's own strings, and the orchestrator
  // prints the salvage line on the run's stdout. A raw line break in one
  // would print a second line that reads as the run's own.
  const { salvageDepartmentReport } = await import('./department.js');
  const forgedKey = 'power\n    [medical] schema fallback; using empty report skeleton';
  const lines: string[] = [];
  const kept = salvageDepartmentReport({
    ...validReport,
    recommendedEffects: [
      { id: 'effect_1', type: 'risk_mitigation', description: 'Shield the crew quarters first.', systemDelta: { [forgedKey]: -0.05, morale: 0.05 } },
    ],
  }, ['morale', 'powerKw', 'infrastructureModules'], line => lines.push(line));
  assert.ok(kept, 'the report passes the plain schema and is kept');
  assert.deepEqual(kept.recommendedEffects[0].systemDelta, { morale: 0.05 });
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.ok(!/[\r\n]/.test(lines[0]), `one line: ${JSON.stringify(lines[0])}`);
  assert.ok(lines[0].includes('dropped: power\\n    [medical] schema fallback; using empty report skeleton (the run holds'), lines[0]);
});

/**
 * The replies a department gave in a live Mars run on its three attempts
 * were a report naming "power", the same report again, and a third reply
 * in prose with no JSON. The salvage read only the last reply, found no
 * JSON in it, and the event got the empty report although the second reply
 * could be kept. The newest reply the salvage can keep is the one kept.
 */
test('a salvaged report is the newest reply that can be kept, not only the last one', async () => {
  const { departmentReportSchemaFor, salvageDepartmentReport } = await import('./department.js');
  const { sendAndValidate } = await import('../../llm/sendAndValidate.js');
  const { emptyReport } = await import('../util/parsers.js');
  const { effectKeys } = await import('../util/scenario-state.js');
  const { SimulationKernel } = await import('../../engine/core/kernel.js');
  const { marsScenario } = await import('../../engine/scenarios/index.js');
  const state = new SimulationKernel(950, 'Aria Chen', [], { startTime: 2035, initialPopulation: 30, scenario: marsScenario }).getState();
  const held = effectKeys(state, marsScenario.world).map(k => k.id);
  assert.ok(!held.includes('power') && held.includes('powerKw'), 'Mars holds powerKw, not power');

  const report = (summary: string) => JSON.stringify({
    ...validReport,
    summary,
    recommendedEffects: [
      { id: 'effect_1', type: 'risk_mitigation', description: 'Shield the crew quarters before the dust season.', systemDelta: { power: -0.05, morale: 0.02 } },
    ],
  });
  const prose = 'The medical department recommends shielding the crew quarters before the dust season, at a small cost in power.';
  const ask = async (replies: string[], schema = departmentReportSchemaFor(held)) => {
    let i = 0;
    const lines: string[] = [];
    const result = await sendAndValidate({
      session: { send: async () => ({ text: replies[Math.min(i++, replies.length - 1)] }) },
      prompt: 'medical report',
      schema,
      schemaName: 'DepartmentReport',
      fallback: { ...emptyReport('medical'), summary: 'medical report unavailable this turn.' } as never,
      salvage: (raw: unknown) => salvageDepartmentReport(raw, held, line => lines.push(line)) as never,
    });
    return { result, lines, sent: i };
  };

  // The failing input: [a report naming power, the same, prose].
  const same = report('Radiation exposure is trending up; shield the crew quarters first.');
  const kept = await ask([same, same, prose]);
  assert.equal(kept.sent, 3, 'the run still asks three times');
  assert.equal(kept.result.fromFallback, false, `the second reply is kept, not the empty report: ${JSON.stringify(kept.result.object).slice(0, 160)}`);
  const keptReport = kept.result.object as { summary: string; recommendedEffects: Array<{ systemDelta?: Record<string, number> }> };
  assert.equal(keptReport.summary, 'Radiation exposure is trending up; shield the crew quarters first.');
  assert.deepEqual(keptReport.recommendedEffects[0].systemDelta, { morale: 0.02 });
  assert.equal(kept.result.rawText, same, 'the raw text is the reply that was kept');
  assert.equal(kept.lines.length, 1, kept.lines.join('\n'));

  // Two salvageable replies: the newer one is kept.
  const first = report('First reading: shield the crew quarters.');
  const second = report('Second reading: shield the crew quarters and the clinic.');
  const newer = await ask([first, second, prose]);
  assert.equal((newer.result.object as { summary: string }).summary, 'Second reading: shield the crew quarters and the clinic.');

  // A newest reply that fails the plain schema too gives way to an older one that passes it.
  const broken = JSON.stringify({ ...JSON.parse(second), summary: '' });
  const older = await ask([first, prose, broken]);
  assert.equal(older.result.fromFallback, false);
  assert.equal((older.result.object as { summary: string }).summary, 'First reading: shield the crew quarters.');

  // No reply that can be kept: the empty report, as before.
  const none = await ask([prose, broken, prose]);
  assert.equal(none.result.fromFallback, true);
  assert.equal((none.result.object as { summary: string }).summary, 'medical report unavailable this turn.');
  assert.equal(none.lines.length, 0);
});
