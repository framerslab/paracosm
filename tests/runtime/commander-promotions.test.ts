/**
 * Turn-0 promotions against the ids the commander actually returns.
 *
 * The roster id of "Dr. Priya Singh" used to keep the period
 * ("col-dr.-priya-singh") while commanders wrote it without
 * ("col-dr-priya-singh") or without the title ("col-priya-singh"), so
 * the kernel threw "Agent ... not found" and a fallback head took the
 * department instead of the commander's pick. These tests drive
 * runDepartmentPromotions (the function the orchestrator calls) with
 * Atlas Lab's departments from scenarios/atlas-lab.json and a stubbed
 * commander reply in place of the model call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import type { KeyPersonnel } from '../../src/engine/core/agent-generator.js';
import { runDepartmentPromotions } from '../../src/runtime/orchestrator/commander-setup.js';
import type { ActorConfig, ScenarioPackage } from '../../src/engine/types.js';

const atlasLab = JSON.parse(
  readFileSync(new URL('../../scenarios/atlas-lab.json', import.meta.url), 'utf-8'),
) as ScenarioPackage;

const leader = { name: 'Marcus Reinhardt' } as ActorConfig;

const keyPersonnel: KeyPersonnel[] = [
  { name: 'Dr. Priya Singh', department: 'alignment_research', role: 'Senior Researcher', specialization: 'Interpretability', age: 41, featured: true },
  { name: 'Dr. Yuki Tanaka', department: 'governance', role: 'Policy Lead', specialization: 'Model Policy', age: 38, featured: true },
];

async function promote(kernel: SimulationKernel, promotions: Array<{ agentId: string; department: string; role: string }>) {
  const emitted: Array<Record<string, unknown>> = [];
  const logs: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  try {
    await runDepartmentPromotions({
      kernel,
      scenario: atlasLab,
      leader,
      startTime: 1,
      sendToCommander: async () => ({
        text: JSON.stringify({ promotions: promotions.map(p => ({ ...p, reason: 'test pick' })) }),
      }),
      trackUsage: () => {},
      emit: (_type, data) => { if (data) emitted.push(data); },
    });
  } finally {
    console.log = realLog;
  }
  return { emitted, logs };
}

test('promotions resolve ids written with or without the period, and an unknown id still fails', async () => {
  const kernel = new SimulationKernel(11, 'marcus-reinhardt', keyPersonnel, { startTime: 1, initialPopulation: 24 });
  const { emitted, logs } = await promote(kernel, [
    { agentId: 'col-dr-priya-singh', department: 'alignment_research', role: 'Head of Interpretability' },
    { agentId: 'col-dr.-yuki-tanaka', department: 'governance', role: 'Chief Policy Strategist' },
    { agentId: 'col-nobody-at-all', department: 'communications', role: 'Voice of the Lab' },
  ]);

  const state = kernel.getState();
  const priya = state.agents.find(a => a.core.name === 'Dr. Priya Singh')!;
  const yuki = state.agents.find(a => a.core.name === 'Dr. Yuki Tanaka')!;

  assert.equal(priya.promotion?.role, 'Head of Interpretability', `logs: ${logs.join(' | ')}`);
  assert.equal(priya.promotion?.promotedBy, 'Marcus Reinhardt');
  assert.equal(yuki.promotion?.role, 'Chief Policy Strategist', `logs: ${logs.join(' | ')}`);
  assert.ok(!logs.some(l => l.includes('col-dr-priya-singh not found')), 'Priya promotion failed');
  assert.ok(!logs.some(l => l.includes('col-dr.-yuki-tanaka not found')), 'Yuki promotion failed');

  // The SSE event carries the roster id, so the dashboard can match it.
  const emittedIds = emitted.map(e => e.agentId);
  assert.ok(emittedIds.includes(priya.core.id), `emitted ${JSON.stringify(emittedIds)}`);
  assert.ok(emittedIds.includes(yuki.core.id), `emitted ${JSON.stringify(emittedIds)}`);

  // An id that names nobody fails as before, and the fallback fills its department.
  assert.ok(logs.some(l => l.includes('Promotion failed: Error: Agent col-nobody-at-all not found')), `logs: ${logs.join(' | ')}`);
  assert.ok(!emittedIds.includes('col-nobody-at-all'));
  const commsHead = state.agents.find(a => a.promotion?.department === 'communications');
  assert.equal(commsHead?.promotion?.role, 'Head of Comms');

  // New ids hold only lowercase letters, digits and hyphens.
  assert.equal(priya.core.id, 'col-dr-priya-singh');
  assert.equal(yuki.core.id, 'col-dr-yuki-tanaka');
  for (const a of state.agents) assert.match(a.core.id, /^col-[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('a commander that drops the title still reaches the titled person; an exact id wins', async () => {
  const kernel = new SimulationKernel(11, 'marcus-reinhardt', [
    ...keyPersonnel,
    { name: 'Yuki Tanaka', department: 'communications', role: 'Writer', specialization: 'Comms', age: 30, featured: false },
  ], { startTime: 1, initialPopulation: 24 });
  await promote(kernel, [
    { agentId: 'col-priya-singh', department: 'alignment_research', role: 'Head of Interpretability' },
    { agentId: 'col-yuki-tanaka', department: 'communications', role: 'Head of Lab Voice' },
  ]);
  const state = kernel.getState();
  assert.equal(state.agents.find(a => a.core.name === 'Dr. Priya Singh')!.promotion?.role, 'Head of Interpretability');
  assert.equal(state.agents.find(a => a.core.name === 'Yuki Tanaka')!.promotion?.role, 'Head of Lab Voice');
  assert.notEqual(state.agents.find(a => a.core.name === 'Dr. Yuki Tanaka')!.promotion?.role, 'Head of Lab Voice');
});

test('a saved run that holds an old id with the period still takes promotions', () => {
  const kernel = new SimulationKernel(11, 'marcus-reinhardt', keyPersonnel, { startTime: 1, initialPopulation: 24 });
  const snap = kernel.toSnapshot('atlas-lab');
  const saved = snap.state.agents.find(a => a.core.name === 'Dr. Priya Singh')!;
  saved.core.id = 'col-dr.-priya-singh';
  const forked = SimulationKernel.fromSnapshot(JSON.parse(JSON.stringify(snap)), 'atlas-lab');

  forked.promoteAgent('col-dr-priya-singh', 'alignment_research', 'Head of Interpretability', 'Marcus Reinhardt');

  const priya = forked.getState().agents.find(a => a.core.name === 'Dr. Priya Singh')!;
  assert.equal(priya.core.id, 'col-dr.-priya-singh');
  assert.equal(priya.promotion?.role, 'Head of Interpretability');
  assert.throws(
    () => forked.promoteAgent('col-nobody-at-all', 'governance', 'Anything', 'Marcus Reinhardt'),
    /Agent col-nobody-at-all not found/,
  );
});

test('names in another alphabet, and names that differ only by an accent, keep their own ids and promotions', async () => {
  const kernel = new SimulationKernel(11, 'marcus-reinhardt', [
    { name: 'Олег Иванов', department: 'alignment_research', role: 'Senior Researcher', specialization: 'Interpretability', age: 44, featured: true },
    { name: 'Анна Петрова', department: 'governance', role: 'Policy Lead', specialization: 'Model Policy', age: 39, featured: true },
    { name: 'José Silva', department: 'communications', role: 'Writer', specialization: 'Comms', age: 31, featured: false },
    { name: 'Jose Silva', department: 'deployment_engineering', role: 'Engineer', specialization: 'Infrastructure', age: 33, featured: false },
  ], { startTime: 1, initialPopulation: 24 });
  const ids = kernel.getState().agents.map(a => a.core.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(', ')}`);

  // The commander picks Анна for governance by the id it was shown; the
  // fallback fills the other four departments by roster id.
  const anna = kernel.getState().agents.find(a => a.core.name === 'Анна Петрова')!;
  const { logs } = await promote(kernel, [{ agentId: anna.core.id, department: 'governance', role: 'Chief Policy Officer' }]);

  const state = kernel.getState();
  assert.equal(state.agents.find(a => a.core.name === 'Анна Петрова')!.promotion?.department, 'governance', `logs: ${logs.join(' | ')}`);
  for (const d of atlasLab.departments) {
    const heads = state.agents.filter(a => a.promotion?.department === d.id).map(a => a.core.name);
    assert.equal(heads.length, 1, `${d.id} heads: ${JSON.stringify(heads)}`);
  }
});

/**
 * The live Atlas Lab pair of 1 November 2026 (run_b535e0f2): one
 * commander named departments by label ("Alignment Research"), the other
 * by a short form ("alignment"). promoteAgent wrote that text into the
 * head's department, so the head left its real department, the fallback
 * found no head there and promoted a second one: 10 heads for 5
 * departments. Ids that named nobody ("col-s-erna-??") failed as well.
 */
async function promoteWithPrompt(
  kernel: SimulationKernel,
  promotions: Array<{ agentId: string; department: string; role: string }>,
  activeDepartments?: string[],
) {
  const prompts: string[] = [];
  const logs: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  try {
    await runDepartmentPromotions({
      kernel,
      scenario: atlasLab,
      leader,
      startTime: 1,
      ...(activeDepartments ? { activeDepartments } : {}),
      sendToCommander: async (prompt: string) => {
        prompts.push(prompt);
        return { text: JSON.stringify({ promotions: promotions.map(p => ({ ...p, reason: 'test pick' })) }) };
      },
      trackUsage: () => {},
      emit: () => {},
    } as Parameters<typeof runDepartmentPromotions>[0]);
  } finally {
    console.log = realLog;
  }
  return { prompts, logs };
}

test('departments named by label or short form reach the scenario department; unknown ones are refused; each department ends with one head', async () => {
  const kernel = new SimulationKernel(11, 'marcus-reinhardt', [
    ...keyPersonnel,
    { name: 'Ada Brandt', department: 'capability_research', role: 'Researcher', specialization: 'Scaling', age: 35, featured: false },
    { name: 'Ken Ito', department: 'deployment_engineering', role: 'Engineer', specialization: 'Infrastructure', age: 33, featured: false },
  ], { startTime: 1, initialPopulation: 24, scenario: atlasLab });
  const id = (name: string) => kernel.getState().agents.find(a => a.core.name === name)!.core.id;

  const { prompts, logs } = await promoteWithPrompt(kernel, [
    { agentId: id('Dr. Priya Singh'), department: 'Alignment Research', role: 'Director of Alignment' },
    { agentId: id('Ada Brandt'), department: 'capability', role: 'Director of Capability' },
    { agentId: id('Dr. Yuki Tanaka'), department: 'governance', role: 'Chief Policy Officer' },
    // A second head for a department that already has one.
    { agentId: id('Ken Ito'), department: 'Governance', role: 'Deputy Policy Officer' },
    // A department the scenario does not have.
    { agentId: id('Ken Ito'), department: 'Marketing', role: 'Head of Marketing' },
    // An id that names nobody, as the live run returned.
    { agentId: 'col-s-erna-??', department: 'communications', role: 'Head of Comms' },
  ]);

  const state = kernel.getState();
  const deptIds = atlasLab.departments.map(d => d.id);
  for (const d of deptIds) {
    const heads = state.agents.filter(a => a.promotion?.department === d).map(a => a.core.name);
    assert.equal(heads.length, 1, `${d} heads: ${JSON.stringify(heads)}; logs: ${logs.join(' | ')}`);
  }
  assert.equal(state.agents.filter(a => a.promotion).length, deptIds.length);
  // No head is moved out of the scenario's departments.
  for (const a of state.agents.filter(a => a.promotion)) {
    assert.ok(deptIds.includes(a.core.department), `${a.core.name} moved to ${a.core.department}`);
    assert.equal(a.core.department, a.promotion!.department);
  }
  // The label and the short form reached the commander's picks.
  assert.equal(state.agents.find(a => a.core.name === 'Dr. Priya Singh')!.promotion?.department, 'alignment_research');
  assert.equal(state.agents.find(a => a.core.name === 'Ada Brandt')!.promotion?.department, 'capability_research');
  assert.equal(state.agents.find(a => a.core.name === 'Dr. Yuki Tanaka')!.promotion?.role, 'Chief Policy Officer');
  assert.notEqual(state.agents.find(a => a.core.name === 'Ken Ito')!.promotion?.role, 'Deputy Policy Officer');
  assert.notEqual(state.agents.find(a => a.core.name === 'Ken Ito')!.promotion?.role, 'Head of Marketing');
  // Each refusal is one log line.
  assert.equal(logs.filter(l => l.includes('Marketing')).length, 1, `logs: ${logs.join(' | ')}`);
  assert.equal(logs.filter(l => l.includes('col-s-erna-??')).length, 1, `logs: ${logs.join(' | ')}`);

  // The prompt is the lab's own: its departments by id and label, its
  // population noun, a count from its departments, no Mars example.
  const prompt = prompts[0];
  assert.ok(prompt, 'no prompt sent');
  for (const d of atlasLab.departments) {
    assert.ok(prompt.includes(d.id), `prompt lacks ${d.id}`);
    assert.ok(prompt.includes(d.label), `prompt lacks ${d.label}`);
  }
  assert.match(prompt, /promote 5 researchers/);
  assert.doesNotMatch(prompt, /colonist/i);
  assert.doesNotMatch(prompt, /medical/i);
});

test('promotions fill only the departments the run keeps active', async () => {
  // The hosted demo keeps three departments; the commander and the
  // fallback promoted heads for all five, and the run reported 10 heads.
  const kernel = new SimulationKernel(11, 'marcus-reinhardt', keyPersonnel, { startTime: 1, initialPopulation: 24, scenario: atlasLab });
  const active = ['alignment_research', 'capability_research', 'governance'];
  const { prompts } = await promoteWithPrompt(kernel, [
    { agentId: kernel.getState().agents.find(a => a.core.name === 'Dr. Priya Singh')!.core.id, department: 'alignment_research', role: 'Director of Alignment' },
  ], active);

  const heads = kernel.getState().agents.filter(a => a.promotion).map(a => a.promotion!.department);
  assert.deepEqual(heads.sort(), [...active].sort());
  assert.match(prompts[0], /promote 3 researchers/);
  assert.doesNotMatch(prompts[0], /deployment_engineering|communications/);
});
