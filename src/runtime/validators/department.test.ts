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
