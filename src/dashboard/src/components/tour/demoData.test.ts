/**
 * The guided tour's demo run is a Mars Genesis run, so the people in it sit
 * where Mars Genesis seats them.
 *
 * The tour's reactions seated Carlos Fernandez as Chief Scientist in a
 * science department, while scenarios/mars.json (and the run path's
 * DEFAULT_KEY_PERSONNEL, which equals its preset) seats him as Senior
 * Geologist in engineering, and Mars Genesis has no science department.
 * The tour's roster put people in science and logistics too.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEMO_EVENTS } from './demoData.js';

interface MarsJson {
  departments: Array<{ id: string; role: string }>;
  presets: Array<{ personnel: Array<{ name: string; department: string; role: string }> }>;
}

const mars = JSON.parse(readFileSync(new URL('../../../../../scenarios/mars.json', import.meta.url), 'utf8')) as MarsJson;
const departments = new Set(mars.departments.map(d => d.id));
const headRoles = new Map(mars.departments.map(d => [d.role, d.id] as const));
const preset = new Map(mars.presets[0].personnel.map(p => [p.name, p] as const));

test('every person in the tour\'s reactions sits in a Mars Genesis department, as Mars Genesis seats them', () => {
  let seen = 0;
  for (const event of DEMO_EVENTS) {
    const reactions = event.data?.reactions;
    if (!Array.isArray(reactions)) continue;
    for (const r of reactions as Array<{ name: string; role: string; department: string }>) {
      seen++;
      const where = `${event.leader}, turn ${String(event.data?.turn)}: ${r.name} (${r.role}, ${r.department})`;
      assert.ok(departments.has(r.department), `${where} sits in a department Mars Genesis does not have`);
      const headOf = headRoles.get(r.role);
      if (headOf !== undefined) {
        // A department head the commander named carries that department's title.
        assert.equal(r.department, headOf, `${where} carries the title of the head of ${headOf}`);
        continue;
      }
      const seeded = preset.get(r.name);
      if (seeded) {
        assert.equal(r.role, seeded.role, `${where}: Mars Genesis seeds ${r.name} as ${seeded.role}`);
        assert.equal(r.department, seeded.department, `${where}: Mars Genesis seeds ${r.name} in ${seeded.department}`);
      }
    }
  }
  assert.ok(seen > 0, 'the tour has reactions');
});

test('every person on the tour\'s roster works in a Mars Genesis department', () => {
  let seen = 0;
  for (const event of DEMO_EVENTS) {
    const agents = event.data?.agents;
    if (event.type !== 'systems_snapshot' || !Array.isArray(agents)) continue;
    for (const a of agents as Array<{ name: string; department: string }>) {
      seen++;
      assert.ok(departments.has(a.department), `${event.leader}, turn ${String(event.data?.turn)}: ${a.name} works in ${a.department}, which Mars Genesis does not have`);
    }
  }
  assert.ok(seen > 0, 'the tour has a roster');
});
