import * as React from 'react';
import { useState } from 'react';
import { useScenarioContext } from '../../App';
import styles from './LoadedScenarioCTA.module.scss';

void React;

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

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h2 className={styles.heading} id={headingId}>
        ▶ Run with the loaded scenario: {scenarioName}
      </h2>
      {tagline && <p className={styles.tagline}>{tagline}</p>}
      <div className={styles.subline}>{leaderLine}</div>
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
