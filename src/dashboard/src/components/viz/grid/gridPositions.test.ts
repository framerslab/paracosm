import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGridPositions } from './gridPositions.js';
import type { CellSnapshot, ClusterMode } from '../viz-types.js';

function cell(
  agentId: string,
  department = 'medical',
  overrides: Partial<CellSnapshot> = {},
): CellSnapshot {
  return {
    agentId,
    name: agentId,
    department,
    role: 'doctor',
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

test('gridPositions: same (agentId, mode, w, h) produces identical coords', () => {
  const cells = [cell('a'), cell('b'), cell('c')];
  const mode: ClusterMode = 'departments';
  const a1 = computeGridPositions(cells, mode, 512, 320);
  const a2 = computeGridPositions(cells, mode, 512, 320);
  for (const c of cells) {
    assert.deepEqual(a1.get(c.agentId), a2.get(c.agentId), `stable pos for ${c.agentId}`);
  }
});

test('gridPositions: all positions fall within canvas bounds with 8px margin', () => {
  const cells = Array.from({ length: 40 }, (_, i) => cell(`c${i}`, i % 2 ? 'medical' : 'engineering'));
  const positions = computeGridPositions(cells, 'departments', 512, 320);
  for (const [, pos] of positions) {
    assert.ok(pos.x >= 8 && pos.x <= 512 - 8, `x in bounds: ${pos.x}`);
    assert.ok(pos.y >= 8 && pos.y <= 320 - 8, `y in bounds: ${pos.y}`);
  }
});

test('gridPositions: departments mode clusters same-dept colonists', () => {
  const medical = Array.from({ length: 5 }, (_, i) => cell(`m${i}`, 'medical'));
  const engineering = Array.from({ length: 5 }, (_, i) => cell(`e${i}`, 'engineering'));
  const positions = computeGridPositions([...medical, ...engineering], 'departments', 512, 320);
  const medAvg = medical.reduce(
    (acc, c) => {
      const p = positions.get(c.agentId)!;
      return { x: acc.x + p.x / medical.length, y: acc.y + p.y / medical.length };
    },
    { x: 0, y: 0 },
  );
  const engAvg = engineering.reduce(
    (acc, c) => {
      const p = positions.get(c.agentId)!;
      return { x: acc.x + p.x / engineering.length, y: acc.y + p.y / engineering.length };
    },
    { x: 0, y: 0 },
  );
  const centerDist = Math.hypot(medAvg.x - engAvg.x, medAvg.y - engAvg.y);
  assert.ok(
    centerDist > 80,
    `dept clusters separated by ${centerDist.toFixed(1)}px (med=${JSON.stringify(medAvg)}, eng=${JSON.stringify(engAvg)})`,
  );
});

test('gridPositions: age mode sorts young colonists above old (smaller y)', () => {
  const young = cell('young', 'medical', { age: 18 });
  const old = cell('old', 'medical', { age: 70 });
  const positions = computeGridPositions([young, old], 'age', 512, 320);
  assert.ok(positions.get('young')!.y < positions.get('old')!.y, 'young renders above old');
});

test('gridPositions: collision rate below 1% on 200-agent population', () => {
  const depts = ['medical', 'engineering', 'agriculture', 'psychology', 'governance'];
  const cells = Array.from({ length: 200 }, (_, i) => cell(`c${i}`, depts[i % depts.length]));
  const positions = computeGridPositions(cells, 'departments', 512, 320);
  let collisions = 0;
  const pairs = Array.from(positions.values());
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const dx = pairs[i].x - pairs[j].x;
      const dy = pairs[i].y - pairs[j].y;
      if (dx * dx + dy * dy < 4) collisions++;
    }
  }
  const totalPairs = (pairs.length * (pairs.length - 1)) / 2;
  const rate = collisions / totalPairs;
  assert.ok(rate < 0.01, `collision rate ${(rate * 100).toFixed(2)}% < 1%`);
});
