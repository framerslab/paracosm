import * as React from 'react';
import { useState, useEffect } from 'react';
import { useScenarioContext } from '../../App';
import styles from './LoadedScenarioCTA.module.scss';

void React;

/**
 * One entry from `GET /scenarios` — the catalog endpoint that already
 * combines builtin scenarios (Mars Genesis, Lunar Outpost), disk-loaded
 * custom scenarios, and any compiled-from-seed scenarios from this
 * session. The picker just needs id + display name to populate the
 * dropdown; description and source stay around for the option label
 * suffix so the user can tell apart `[builtin]` Mars Genesis from a
 * `[compiled]` scenario they pasted in earlier.
 */
interface CatalogScenario {
  id: string;
  name: string;
  description?: string;
  departments?: number;
  source?: string;
}

interface LoadedScenarioCTAProps {
  /** Fires on click with the user's chosen actor count. Parent
   *  (QuickstartView) decides whether to post to `/setup` directly
   *  (presets present) or route through actor-generation first. */
  onRunStart: (actorCount: number) => void;
  /** Disabled flag from parent — prevents double-launch during a
   *  running compile / setup. */
  disabled?: boolean;
  /** Initial actor count. Defaults to 2 (matches the loaded scenario's
   *  typical 2-leader preset shape). */
  initialActorCount?: number;
}

/**
 * Primary CTA card for the Quickstart tab. Surfaces the currently-loaded
 * scenario for one-click run, bypassing compile-from-seed when the
 * scenario already ships with leader presets.
 */
export function LoadedScenarioCTA({
  onRunStart,
  disabled = false,
  initialActorCount = 2,
}: LoadedScenarioCTAProps) {
  const scenario = useScenarioContext();
  const [actorCount, setActorCount] = useState<number>(initialActorCount);
  const [launching, setLaunching] = useState<boolean>(false);
  // Catalog of scenarios available on the server — Mars Genesis +
  // Lunar Outpost ship as builtins, anything compiled-from-seed in
  // this session shows up here too so users can flip between
  // "Mars Genesis" and the AI-Sup council scenario they pasted in
  // earlier without leaving the Quickstart tab. Empty array until the
  // /scenarios fetch resolves; we render the picker only when we
  // actually have ≥2 entries to pick between (1-entry catalogs would
  // show a redundant single-option dropdown).
  const [scenarios, setScenarios] = useState<CatalogScenario[]>([]);
  const [switchingScenario, setSwitchingScenario] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/scenarios')
      .then(r => r.ok ? r.json() as Promise<{ scenarios?: CatalogScenario[] }> : null)
      .then(body => {
        if (cancelled) return;
        setScenarios(body?.scenarios ?? []);
      })
      .catch(() => { /* picker hides on fetch failure; CTA still works for the active scenario */ });
    return () => { cancelled = true; };
  }, []);

  const handleSwitchScenario = async (id: string) => {
    if (id === scenario.id || switchingScenario) return;
    setSwitchingScenario(true);
    try {
      const res = await fetch('/scenario/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        // Server-side activeScenario flipped. Reload so useScenario
        // re-fetches /scenario, ScenarioContext re-binds with the new
        // labels/presets/policies, and every downstream surface
        // (CTA copy, leaders row, scenario titles) stays consistent.
        // Same pattern SettingsPanel uses for its own switcher.
        window.location.reload();
      } else {
        setSwitchingScenario(false);
      }
    } catch {
      setSwitchingScenario(false);
    }
  };

  // Server projects ScenarioPreset.leaders (engine-side field name)
  // through unchanged; older compile-from-seed paths used `actors`.
  // Read both so the CTA picks up presets regardless of which field
  // the server chose to populate.
  const presetActors = scenario.presets[0]?.leaders ?? scenario.presets[0]?.actors ?? [];
  const presetCount = presetActors.length;
  const hasPreset = presetCount >= 2;
  // Slider goes to 300 (matches generate-actors API + SeedInput range).
  // When the user picks more than presetCount, QuickstartView's
  // loaded-scenario handler routes through /api/quickstart/generate-actors
  // for the extra slots beyond the preset, so the run still launches —
  // it just costs an extra ~30s for the LLM to generate the additional
  // HEXACO profiles. Capping at presetCount (the previous behavior)
  // silently clamped users to 2 for Mars Genesis even when they had
  // dragged the slider to 3+; the third actor never made it into the
  // SIM/VIZ render because state.actorIds.length was never > 2.
  const sliderMax = 300;
  const exceedsPreset = actorCount > presetCount;
  const scenarioName = scenario.labels.name;
  // Optional 1-2 sentence "what's this scenario about" line. Mars
  // Genesis ships with one out of the box; compile-from-seed and
  // user-uploaded scenarios usually don't, so this falls back to the
  // existing leader-pair tradition.
  const tagline = scenario.labels.tagline?.trim();

  const leaderLine = hasPreset
    ? `${presetActors[0].name} (${presetActors[0].archetype}) vs ${presetActors[1].name} (${presetActors[1].archetype})`
    : 'Auto-generated leaders (no preset)';

  const headingId = 'loaded-scenario-cta-heading';
  const sliderId = 'loaded-scenario-actor-count';

  const handleClick = () => {
    if (launching || disabled) return;
    setLaunching(true);
    onRunStart(actorCount);
    // Parent owns the actual fetch — it'll re-render with disabled=true
    // for the duration of the run, which keeps this button gated.
  };

  const actorLabel = `${actorCount} ${actorCount === 1 ? 'actor' : 'actors'}`;
  const accessibleRunLabel = launching ? 'Launching...' : `Run ${actorLabel} against ${scenarioName}`;
  const fullRunLabel = launching ? 'Launching...' : `${accessibleRunLabel} ->`;
  const compactRunLabel = launching ? 'Launching...' : `Run ${actorLabel}`;

  const scenarioPickerId = 'loaded-scenario-cta-picker';

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h2 className={styles.heading} id={headingId}>
        ▶ Run with the loaded scenario: {scenarioName}
      </h2>
      {tagline && <p className={styles.tagline}>{tagline}</p>}
      <div className={styles.subline}>{leaderLine}</div>
      {/* Scenario switcher. Only renders when the catalog has ≥2
          entries (a single-option dropdown is just chrome). The active
          scenario stays selected; picking another fires
          /scenario/switch and reloads the page so every downstream
          surface re-binds against the new active scenario. */}
      {scenarios.length >= 2 && (
        <div className={styles.scenarioPickerRow}>
          <label className={styles.scenarioPickerLabel} htmlFor={scenarioPickerId}>
            Scenario
          </label>
          <select
            id={scenarioPickerId}
            className={styles.scenarioPickerSelect}
            value={scenario.id}
            onChange={(e) => handleSwitchScenario(e.target.value)}
            disabled={disabled || launching || switchingScenario}
            aria-label="Switch active scenario"
          >
            {scenarios.map(s => {
              const tag = s.source === 'builtin' ? ' [builtin]'
                : s.source === 'disk' ? ' [disk]'
                : s.source === 'compiled' ? ' [compiled]'
                : '';
              return (
                <option key={s.id} value={s.id}>
                  {s.name}{tag}
                </option>
              );
            })}
          </select>
          {switchingScenario && (
            <span className={styles.scenarioPickerHint}>Switching…</span>
          )}
        </div>
      )}
      <div className={styles.actorRow}>
        <label className={styles.actorLabel} htmlFor={sliderId}>Actors</label>
        <input
          id={sliderId}
          type="range"
          min={1}
          max={sliderMax}
          value={actorCount}
          onChange={(e) => setActorCount(parseInt(e.target.value, 10))}
          disabled={disabled || launching}
          className={styles.actorSlider}
          aria-label="Number of parallel actors"
        />
        <span className={styles.actorValue}>{actorCount}</span>
      </div>
      <button
        type="button"
        className={styles.runButton}
        onClick={handleClick}
        disabled={disabled || launching}
        aria-busy={launching}
        aria-label={accessibleRunLabel}
      >
        <span className={styles.runButtonFull} aria-hidden="true">{fullRunLabel}</span>
        <span className={styles.runButtonCompact} aria-hidden="true">{compactRunLabel}</span>
      </button>
      <div className={styles.tradeoff}>
        {hasPreset && !exceedsPreset && 'Same scenario, fresh seed: skips the compile step.'}
        {hasPreset && exceedsPreset && `Same scenario; ${actorCount} LLM-generated actors replace the preset leaders for this run (~30s for generation).`}
        {!hasPreset && 'Same scenario; ~30s for actor generation since no preset is defined.'}
      </div>
    </section>
  );
}
