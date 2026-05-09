/**
 * One-line plain-English tooltip text for every labeled element on the
 * VIZ tab. Centralized here so a future i18n pass has one file to
 * translate. SwarmViz, VizLegendBar, HighlightStrip, and the Tile
 * outline labels all read from this table.
 *
 * Copy budget: 10–160 chars per entry. Longer text belongs in the
 * full-legend popover, not in a hover tooltip.
 *
 * @module viz/viz-tooltips
 */
export const VIZ_TOOLTIPS = {
  'tab.living': "Who's alive this turn — agents on the scenario grid.",
  'tab.mood': 'Aggregate mood mix per leader: hopeful / neutral / anxious / negative.',
  'tab.forge': 'Computational tools the agents forged in the V8 sandbox this turn.',
  'tab.ecology': 'Resource and environment metrics: power, food, water, radiation.',
  'tab.divergence': 'Per-metric A-vs-B deltas across all turns.',
  'badge.forge': 'Forge attempts on this turn — click FORGE for details.',
  'badge.divergence': 'Metrics diverged this turn — click DIVERGENCE for the rail.',
  'stat.morale': 'Aggregate morale across all alive agents (0–100%).',
  'stat.moodMix': 'Distribution of agents across the four mood tiers, weighted by morale.',
  'stat.alive': 'Living agents in this colony at the current turn.',
  'stat.age': 'Age distribution of living agents (4 bins: <20 / 20–40 / 40–60 / 60+).',
  'stat.paired': 'Alive agents currently in a partnership pair.',
  'stat.earth': "Agents born on Earth (vs Native — born after the colony's first birth event).",
  'stat.native': 'Agents born in the colony itself (Marsborn / Lunarborn / scenario-specific).',
  'stat.depts': 'Agent count by department. Hover a wedge for the dept name.',
  'chip.rising': 'Aggregate morale trending up vs the previous turn.',
} as const;

export type VizTooltipKey = keyof typeof VIZ_TOOLTIPS;
