import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCellDiff, type DiffCell } from './viz-diff';

const cell = (overrides: Partial<DiffCell> = {}): DiffCell => ({
  cellKey: 'med-0',
  department: 'medical',
  agentCount: 0,
  dominantMood: 'steady',
  ...overrides,
});

describe('computeCellDiff', () => {
  it('empty grids produce empty diff', () => {
    const diff = computeCellDiff([], []);
    assert.equal(diff.size, 0);
  });

  it('identical cells produce zero magnitude', () => {
    const a = [cell({ cellKey: 'med-0', agentCount: 4, dominantMood: 'steady' })];
    const diff = computeCellDiff(a, a);
    assert.equal(diff.get('med-0')?.magnitude, 0);
  });

  it('agentCount divergence has nonzero magnitude', () => {
    const a = [cell({ agentCount: 4 })];
    const b = [cell({ agentCount: 0 })];
    const diff = computeCellDiff(a, b);
    const entry = diff.get('med-0');
    assert.ok(entry);
    assert.ok(entry.magnitude > 0, `expected positive magnitude, got ${entry.magnitude}`);
  });

  it('full-grid divergence reports per-cell entries', () => {
    const a = [cell({ cellKey: 'a', agentCount: 4 }), cell({ cellKey: 'b', agentCount: 0 })];
    const b = [cell({ cellKey: 'a', agentCount: 0 }), cell({ cellKey: 'b', agentCount: 4 })];
    const diff = computeCellDiff(a, b);
    assert.ok((diff.get('a')?.magnitude ?? 0) > 0);
    assert.ok((diff.get('b')?.magnitude ?? 0) > 0);
  });

  it('magnitude is monotone in agentCount delta', () => {
    const small = computeCellDiff([cell({ agentCount: 4 })], [cell({ agentCount: 3 })]);
    const large = computeCellDiff([cell({ agentCount: 4 })], [cell({ agentCount: 0 })]);
    assert.ok(
      (large.get('med-0')?.magnitude ?? 0) > (small.get('med-0')?.magnitude ?? 0),
      'wider gap should produce greater magnitude',
    );
  });

  it('mood-only divergence has nonzero magnitude', () => {
    const a = [cell({ dominantMood: 'rising' })];
    const b = [cell({ dominantMood: 'low' })];
    const diff = computeCellDiff(a, b);
    assert.ok((diff.get('med-0')?.magnitude ?? 0) > 0);
  });
});
