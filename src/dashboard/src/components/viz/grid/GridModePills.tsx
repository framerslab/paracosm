export type GridMode = 'living' | 'mood' | 'forge' | 'ecology' | 'divergence';

/** Hints are scenario-templated. `{people}` = plural population noun,
 *  `{person}` = singular, both lower-case. Resolved at render time. */
const MODES: { key: GridMode; label: string; hint: string }[] = [
  { key: 'living', label: 'LIVING', hint: 'Full field + {person} seeds + family lines + all events' },
  { key: 'mood', label: 'MOOD', hint: '{Person} mood cloud emphasized; births / deaths / partner arcs' },
  { key: 'forge', label: 'FORGE', hint: 'Field dimmed; tool forge attempts + reuse arcs between departments' },
  { key: 'ecology', label: 'ECOLOGY', hint: 'Glyphs hidden; metrics strip + crisis shockwaves lead' },
  { key: 'divergence', label: 'DIVERGENCE', hint: 'Only {people} alive here but dead on the other side' },
];

function interpolate(
  template: string,
  labels: { person: string; people: string; Person: string; People: string },
): string {
  return template
    .replace(/\{person\}/g, labels.person)
    .replace(/\{Person\}/g, labels.Person)
    .replace(/\{people\}/g, labels.people)
    .replace(/\{People\}/g, labels.People);
}

export function gridModeHint(
  mode: GridMode,
  labels: { person: string; people: string; Person: string; People: string },
): string {
  const template = MODES.find(m => m.key === mode)?.hint ?? '';
  return interpolate(template, labels);
}

/**
 * Mode pill row rendered above each leader grid. Shared state lifted
 * to SwarmViz so toggling on one leader also toggles the other —
 * panels stay visually comparable across mode switches.
 * Optional counts render as a "· N" suffix — typically used for FORGE
 * (total approved forges across both leaders) and DIVERGENCE (total
 * diverged colonists across both sides).
 */
export function GridModePills({
  mode,
  onChange,
  counts,
  labels,
}: {
  mode: GridMode;
  onChange: (next: GridMode) => void;
  counts?: Partial<Record<GridMode, number>>;
  labels: { person: string; people: string; Person: string; People: string };
}) {
  return (
    <div
      role="tablist"
      aria-label="Grid viz mode"
      style={{
        display: 'flex',
        gap: 0,
        padding: '4px 6px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        // Five labels (LIVING/MOOD/FORGE/ECOLOGY/DIVERGENCE) at
        // whitespace-nowrap don't shrink below their text width, so
        // they overflow on phone viewports and visually slide under
        // the ⋯ + ? Help buttons next to this row. overflow-x:auto
        // clips at the container bound; touch-swipe (or mouse scroll)
        // brings hidden pills into view without them stomping the
        // toolbar buttons.
        overflowX: 'auto',
        scrollbarWidth: 'thin',
      }}
    >
      {MODES.map((m, i) => {
        const active = mode === m.key;
        const count = counts?.[m.key];
        const resolvedHint = interpolate(m.hint, labels);
        return (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={active}
            data-grid-mode={m.key}
            onClick={() => onChange(m.key)}
            title={resolvedHint}
            style={{
              // 1 0 auto: grow to fill the row on desktop, but never
              // shrink below the natural label width. With nowrap text
              // this means pills always render legibly; the container's
              // overflow-x:auto absorbs the leftover width on phone
              // viewports rather than squishing pills into letter-stacks.
              flex: '1 0 auto',
              padding: '5px 8px',
              fontSize: 'var(--font-3xs)',
              fontFamily: 'var(--mono)',
              fontWeight: 800,
              letterSpacing: '0.1em',
              border: '1px solid var(--border)',
              borderLeft: i === 0 ? '1px solid var(--border)' : 'none',
              borderRadius:
                i === 0
                  ? '3px 0 0 3px'
                  : i === MODES.length - 1
                  ? '0 3px 3px 0'
                  : 0,
              background: active ? 'var(--amber)' : 'var(--bg-card)',
              color: active ? 'var(--bg-deep)' : 'var(--text-3)',
              cursor: 'pointer',
              textTransform: 'uppercase',
              transition: 'background 120ms, color 120ms',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
            }}
          >
            <span>{m.label}</span>
            {typeof count === 'number' && count > 0 && (
              <span
                style={{
                  padding: '0 4px',
                  borderRadius: 2,
                  background: active ? 'rgba(10, 8, 6, 0.25)' : 'var(--bg-deep)',
                  color: active ? 'var(--bg-deep)' : 'var(--amber)',
                  fontSize: 'var(--font-3xs)',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  minWidth: 14,
                  textAlign: 'center',
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
