import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout } from './viz-layout.js';
import type { CellSnapshot, TurnSnapshot } from './viz-types.js';

function cell(overrides: Partial<CellSnapshot> & { agentId: string }): CellSnapshot {
  // `name` defaults to the required agentId; everything else gets a
  // sane stub, then the caller's overrides win via the spread. The
  // explicit `agentId:` line used to sit at the top; removed because
  // the spread already covers it (TS2783 flagged the duplicate).
  return {
    name: overrides.agentId,
    department: 'medical',
    role: 'role',
    rank: 'junior',
    alive: true,
    marsborn: false,
    psychScore: 0.5,
    childrenIds: [],
    featured: false,
    mood: 'neutral',
    shortTermMemory: [],
    ...overrides,
  };
}

function snap(cells: CellSnapshot[]): TurnSnapshot {
  return {
    turn: 1,
    time: 2040,
    cells,
    population: cells.filter(c => c.alive).length,
    morale: 0.5,
    foodReserve: 6,
    deaths: 0,
    births: 0,
  };
}

test('computeLayout routes featured cells into the featured row', () => {
  const layout = computeLayout(
    snap([cell({ agentId: 'a', featured: true }), cell({ agentId: 'b' })]),
    'families',
  );
  assert.equal(layout.featured.length, 1);
  assert.equal(layout.featured[0].agentId, 'a');
});

test('computeLayout caps featured tiles at FEATURED_CAP', () => {
  const cells = Array.from({ length: 10 }, (_, i) => cell({ agentId: `a${i}`, featured: true }));
  const layout = computeLayout(snap(cells), 'families');
  assert.equal(layout.featured.length, 6);
});

test('computeLayout routes dead cells into ghosts', () => {
  const layout = computeLayout(
    snap([cell({ agentId: 'a', alive: false })]),
    'families',
  );
  assert.equal(layout.ghosts.length, 1);
  assert.equal(layout.ghosts[0].tierInfo.tier, 'dead');
});

test('computeLayout groups partners and children into one pod', () => {
  const layout = computeLayout(
    snap([
      cell({ agentId: 'mom', partnerId: 'dad', childrenIds: ['kid'] }),
      cell({ agentId: 'dad', partnerId: 'mom', childrenIds: ['kid'] }),
      cell({ agentId: 'kid', rank: 'junior' }),
    ]),
    'families',
  );
  assert.equal(layout.pods.length, 1);
  const ids = layout.pods[0].tiles.map(t => t.agentId).sort();
  assert.deepEqual(ids, ['dad', 'kid', 'mom']);
});

test('computeLayout drops solo alive cells into their dept band', () => {
  const layout = computeLayout(
    snap([
      cell({ agentId: 'a', department: 'medical' }),
      cell({ agentId: 'b', department: 'engineering' }),
    ]),
    'families',
  );
  assert.equal(layout.deptBands.medical.length, 1);
  assert.equal(layout.deptBands.engineering.length, 1);
});

test('computeLayout in departments mode collapses everyone to dept bands', () => {
  const layout = computeLayout(
    snap([
      cell({ agentId: 'a', department: 'medical', featured: true }),
      cell({ agentId: 'b', department: 'medical', partnerId: 'c' }),
      cell({ agentId: 'c', department: 'medical', partnerId: 'b' }),
    ]),
    'departments',
  );
  assert.equal(layout.featured.length, 0);
  assert.equal(layout.pods.length, 0);
  assert.equal(layout.deptBands.medical.length, 3);
});
