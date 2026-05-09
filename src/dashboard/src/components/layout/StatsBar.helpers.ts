/**
 * Pure helpers for the StatsBar component. Split out so they can be
 * unit-tested without the component file transitively pulling in
 * SCSS module imports that node:test cannot resolve.
 */

/**
 * Render a status / environment bag as a tooltip-friendly multi-line
 * string. Empty / undefined bags produce an empty string so callers
 * can short-circuit with `if (s)`. Boolean values render as "yes" /
 * "no" (not "true" / "false") since the tooltip is user-facing.
 * Numbers stringify; strings pass through.
 */
export function formatBagTooltip(bag: Record<string, string | number | boolean> | undefined): string {
  if (!bag) return '';
  const entries = Object.entries(bag);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => {
    const display = typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
    return `${k}: ${display}`;
  }).join('\n');
}
