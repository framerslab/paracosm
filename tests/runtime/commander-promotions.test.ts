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
import { resolveActiveDepartments, runDepartmentPromotions } from '../../src/runtime/orchestrator/commander-setup.js';
import type { KernelSnapshot } from '../../src/engine/core/snapshot.js';
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
  const emitted: Array<Record<string, unknown>> = [];
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
      emit: (_type: string, data?: Record<string, unknown>) => { emitted.push(data ?? {}); },
    } as Parameters<typeof runDepartmentPromotions>[0]);
  } finally {
    console.log = realLog;
  }
  return { prompts, logs, emitted };
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

test('an active list that names none of the scenario\'s departments keeps them all, for promotions and the turn loop alike', async () => {
  // The turn loop and the promotions read the same list. With an empty
  // list, or one from another scenario, the promotions filled every
  // department while the turn loop sent events to the first two only.
  const all = atlasLab.departments.map(d => d.id);
  assert.deepEqual(resolveActiveDepartments(undefined, atlasLab.departments), all);
  assert.deepEqual(resolveActiveDepartments([], atlasLab.departments), all);
  assert.deepEqual(resolveActiveDepartments(['medical', 'engineering'], atlasLab.departments), all);
  // A list in another order comes back in the scenario's order.
  assert.deepEqual(
    resolveActiveDepartments(['governance', 'medical', 'alignment_research'], atlasLab.departments),
    ['alignment_research', 'governance'],
  );

  const kernel = new SimulationKernel(11, 'marcus-reinhardt', keyPersonnel, { startTime: 1, initialPopulation: 24, scenario: atlasLab });
  await promoteWithPrompt(kernel, [], ['medical']);
  const heads = kernel.getState().agents.filter(a => a.promotion).map(a => a.promotion!.department);
  assert.deepEqual(heads.sort(), [...all].sort());
});

/** A kernel restored as a fork restores it: a snapshot through JSON. */
function forkOf(parent: SimulationKernel, change?: (snap: KernelSnapshot) => void): SimulationKernel {
  const snap = JSON.parse(JSON.stringify(parent.toSnapshot(atlasLab.id))) as KernelSnapshot;
  change?.(snap);
  return SimulationKernel.fromSnapshot(snap, atlasLab.id);
}

test('a fork whose departments all have a living head asks the commander nothing', async () => {
  // runSimulation runs the promotions on a fork too. Every pick would be
  // refused, so the call only spent money.
  const parent = new SimulationKernel(11, 'marcus-reinhardt', keyPersonnel, { startTime: 1, initialPopulation: 24, scenario: atlasLab });
  await promoteWithPrompt(parent, []);
  const heads = parent.getState().agents.filter(a => a.promotion).map(a => a.core.id).sort();
  assert.equal(heads.length, atlasLab.departments.length);

  const forked = forkOf(parent);
  const { prompts } = await promoteWithPrompt(forked, []);
  assert.equal(prompts.length, 0, 'a commander call with nothing to decide');
  assert.deepEqual(forked.getState().agents.filter(a => a.promotion).map(a => a.core.id).sort(), heads);
});

test('a fork replaces a head who died, and only that head; a dead person is not promoted', async () => {
  const parent = new SimulationKernel(11, 'marcus-reinhardt', keyPersonnel, { startTime: 1, initialPopulation: 24, scenario: atlasLab });
  await promoteWithPrompt(parent, []);
  const dead = parent.getState().agents.find(a => a.promotion?.department === 'governance')!;
  const forked = forkOf(parent, snap => {
    snap.state.agents.find(a => a.core.id === dead.core.id)!.health.alive = false;
  });
  const pick = forked.getCandidates('governance', 1)[0];

  const { prompts, logs } = await promoteWithPrompt(forked, [
    { agentId: dead.core.id, department: 'governance', role: 'Ghost' },
    { agentId: pick.core.id, department: 'Governance', role: 'Chief Policy Officer' },
  ]);

  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /promote one of your researchers/);
  assert.ok(prompts[0].includes('"governance"'));
  assert.ok(!prompts[0].includes('alignment_research'), 'asks about a department that has a head');
  const living = forked.getState().agents.filter(a => a.health.alive && a.promotion?.department === 'governance');
  assert.deepEqual(living.map(a => a.core.id), [pick.core.id]);
  assert.notEqual(forked.findAgent(dead.core.id)!.promotion?.role, 'Ghost');
  assert.ok(logs.some(l => l.includes(dead.core.id) && l.includes('refused')), `logs: ${logs.join(' | ')}`);
});

test('every head is announced to the viewer, the fallback\'s too', async () => {
  // The dashboard's feed lists a head from its promotion event. A pick the
  // commander got wrong, now refused, left its department's head unseen.
  const kernel = new SimulationKernel(11, 'marcus-reinhardt', keyPersonnel, { startTime: 1, initialPopulation: 24, scenario: atlasLab });
  const priya = kernel.getState().agents.find(a => a.core.name === 'Dr. Priya Singh')!;
  const { emitted } = await promoteWithPrompt(kernel, [
    { agentId: priya.core.id, department: 'alignment_research', role: 'Director of Alignment' },
    { agentId: 'col-s-erna-??', department: 'communications', role: 'Head of Comms' },
  ]);
  assert.deepEqual(emitted.map(e => e.department).sort(), atlasLab.departments.map(d => d.id).sort());
  for (const e of emitted) {
    assert.equal(kernel.findAgent(String(e.agentId))?.promotion?.department, e.department);
    assert.ok(e.role, `no role in ${JSON.stringify(e)}`);
  }
});

/**
 * A Mars Genesis run held two heads of medicine, engineering and
 * agriculture (#210). The scenario's preset seeded Dr. Yuki Tanaka as Chief
 * Medical Officer, Erik Lindqvist as Chief Engineer and Amara Osei as Head
 * of Agriculture with no promotion record, so the turn 0 step read each
 * department as open and the commander named a second head for each:
 * Carlos Fernandez, Bruno Morales and Bruno Eriksson in Aria Chen's run on
 * the hosted demo (seed 950, 30 people, three departments). The commander
 * names every head; the seeded people carry specialist titles.
 */
test('a Mars run built from the scenario\'s preset holds one head per department after the commander\'s picks', async () => {
  const { marsScenario } = await import('../../src/engine/scenarios/index.js');
  const { scenarioKeyPersonnel } = await import('../../src/cli/sim-config.js');
  const departments = ['medical', 'engineering', 'agriculture'];
  const kernel = new SimulationKernel(950, 'Aria Chen', scenarioKeyPersonnel(marsScenario), {
    startTime: 2035, initialPopulation: 30, scenario: marsScenario,
  });
  const preset = new Set(scenarioKeyPersonnel(marsScenario).map(p => p.name));
  // The live run's picks, by name; where the generated roster holds no
  // such person, a candidate the preset did not seed.
  const pick = (name: string, dept: string) =>
    kernel.getState().agents.find(a => a.core.name === name)?.core.id
    ?? kernel.getCandidates(dept as never, 10).find(c => !preset.has(c.core.name))!.core.id;
  const roleOf = (dept: string) => marsScenario.departments.find(d => d.id === dept)!.role;
  const picks = [
    { agentId: pick('Carlos Fernandez', 'medical'), department: 'medical', role: roleOf('medical') },
    { agentId: pick('Bruno Morales', 'engineering'), department: 'engineering', role: roleOf('engineering') },
    { agentId: pick('Bruno Eriksson', 'agriculture'), department: 'agriculture', role: roleOf('agriculture') },
  ];
  const logs: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  try {
    await runDepartmentPromotions({
      kernel,
      scenario: marsScenario,
      leader: { name: 'Aria Chen' } as ActorConfig,
      startTime: 2035,
      activeDepartments: departments,
      sendToCommander: async () => ({ text: JSON.stringify({ promotions: picks.map(p => ({ ...p, reason: 'test pick' })) }) }),
      trackUsage: () => {},
      emit: () => {},
    } as Parameters<typeof runDepartmentPromotions>[0]);
  } finally {
    console.log = realLog;
  }

  const living = kernel.getState().agents.filter(a => a.health.alive);
  for (const dept of departments) {
    const titled = living.filter(a => a.core.role === roleOf(dept)).map(a => a.core.name);
    assert.equal(titled.length, 1, `${dept}: ${JSON.stringify(titled)} carry the title ${roleOf(dept)}; logs: ${logs.join(' | ')}`);
    const head = living.find(a => a.core.role === roleOf(dept))!;
    assert.equal(head.promotion?.department, dept, `${head.core.name} holds the ${dept} title with a promotion record`);
    assert.equal(head.core.id, picks.find(p => p.department === dept)!.agentId, `the commander's pick heads ${dept}`);
  }
  const yuki = living.find(a => a.core.name === 'Dr. Yuki Tanaka')!;
  assert.equal(yuki.career.specialization, 'Radiation Medicine');
  assert.equal(yuki.promotion, undefined);
  assert.ok(!marsScenario.departments.some(d => d.role === yuki.core.role), `Dr. Yuki Tanaka is seeded as ${yuki.core.role}`);
});

test('no bundled scenario seeds a person with a department head\'s title', () => {
  // A seeded person with a head's title holds no promotion record, so the
  // promotion step reads the department as open and names a second head.
  for (const file of ['mars.json', 'lunar.json']) {
    const sc = JSON.parse(readFileSync(new URL(`../../scenarios/${file}`, import.meta.url), 'utf-8')) as ScenarioPackage;
    const titles = new Map(sc.departments.map(d => [d.role, d.id]));
    for (const preset of sc.presets ?? []) {
      for (const p of preset.personnel ?? []) {
        assert.ok(!titles.has(p.role), `${file} preset ${preset.id} seeds ${p.name} as ${p.role}, the ${titles.get(p.role)} head's title`);
      }
    }
  }
});
