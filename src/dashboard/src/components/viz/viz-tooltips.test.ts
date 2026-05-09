import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VIZ_TOOLTIPS, type VizTooltipKey } from './viz-tooltips';

describe('VIZ_TOOLTIPS', () => {
  it('covers every element the SwarmViz strip + legend mention', () => {
    const required: VizTooltipKey[] = [
      'tab.living',
      'tab.mood',
      'tab.forge',
      'tab.ecology',
      'tab.divergence',
      'badge.forge',
      'badge.divergence',
      'stat.morale',
      'stat.moodMix',
      'stat.alive',
      'stat.age',
      'stat.paired',
      'stat.earth',
      'stat.native',
      'stat.depts',
      'chip.rising',
    ];
    for (const key of required) {
      const copy = VIZ_TOOLTIPS[key];
      assert.ok(copy, `missing copy for ${key}`);
      assert.ok(copy.length > 10, `${key} copy too short: ${copy}`);
      assert.ok(copy.length < 160, `${key} copy too long: ${copy}`);
    }
  });
});
