/**
 * The shared colony panel: the run's own world before the run, drawn once.
 *
 * Before Start every leader's colony holds the same people, so the colony
 * shows once, above the leaders, and no card carries a field of its own.
 * The panel is the living grid itself (LivingSwarmGrid), at rest at turn 0:
 * the scenario's key people as rings in their departments, each with its
 * Game of Life cells seeded from its place and its neutral mood, in the
 * grid's first colour, the accent amber. Each featured person's name is set
 * over the field as text. The key people are in every run of the scenario,
 * at the values the engine starts them with (startingColony.ts), so each
 * cell carries the run's own starting data. The header names the key people
 * and no count of departments: the scenario line states the departments the
 * run uses, the one count of them on the screen.
 *
 * Until the scenario has loaded, and the server has said whose keys a free
 * run uses, the panel is a frame of its final size. A scenario that names
 * no key people keeps the frame and says the colony is drawn when the run
 * starts; no canvas mounts.
 *
 * @module paracosm/dashboard/quickstart/first-screen/SharedColonyPanel
 */
import { useMemo, type CSSProperties } from 'react';
import { useScenarioContext, useScenarioReady } from '../../../App';
import { LivingSwarmGrid } from '../../viz/grid/LivingSwarmGrid';
import { effectivePeople, payer, readLaunchSettings, safeLocalStorage } from './effectiveLaunch';
import { keyPeopleOf, keyPeopleSnapshot } from './startingColony';
import { useServerFacts } from './useServerFacts';
import {
  COLONY_KEY,
  NO_KEY_PEOPLE,
  TURN_ZERO_MARK,
  colonyCaption,
  colonyFigures,
  colonySpoken,
} from './words';
import styles from './SharedColonyPanel.module.scss';

/** The panel's header, in the grid's own type: the turn mark and the figures. Hidden from a screen reader: the drawing's name says the same. */
function ColonyHeader({ figures, loading }: { figures?: string; loading?: boolean }) {
  return (
    <p className={styles.header} aria-hidden="true">
      <span className={styles.turn} data-testid="colony-turn">{TURN_ZERO_MARK}</span>
      {figures !== undefined && (
        loading
          ? <span className={styles.figures}><span className={styles.shape} data-shape>{figures}</span></span>
          : <span className={styles.figures} data-testid="colony-figures">{figures}</span>
      )}
    </p>
  );
}

/** The key line: each of the grid's three marks beside its word. */
function ColonyKey() {
  const glyph = { color: 'var(--vis)' } as CSSProperties;
  return (
    <div className={styles.keyBox}>
      <ul className={styles.key} data-testid="colony-key" data-row="colony key">
        <li className={styles.keyItem}>
          <svg className={styles.keyGlyph} style={glyph} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <rect x="2" y="2" width="12" height="12" fill="currentColor" />
          </svg>
          <span>{COLONY_KEY.department}</span>
        </li>
        <li className={styles.keyItem}>
          <svg className={styles.keyGlyph} style={glyph} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span>{COLONY_KEY.person}</span>
        </li>
        <li className={styles.keyItem}>
          <svg className={styles.keyGlyph} style={glyph} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
          <span>{COLONY_KEY.featured}</span>
        </li>
      </ul>
    </div>
  );
}

export interface SharedColonyPanelProps {
  /** How many leaders the run takes: a pair says "Both colonies", 3 to 300 say how many. */
  size?: number;
}

export function SharedColonyPanel({ size = 2 }: SharedColonyPanelProps) {
  const scenario = useScenarioContext();
  const ready = useScenarioReady();
  const facts = useServerFacts();

  // Read on each render: the Settings tab may have saved a key since.
  const settings = readLaunchSettings(safeLocalStorage());
  const who = payer(facts, settings.overrides);
  // How many people the colony holds is known once the visitor holds a key or the server has said whether it is the hosted demo.
  // A read of the settings that failed leaves that unknown, so the panel waits as the scenario line's figures do.
  const known = ready && (who === 'own' || typeof facts.adminConfig.hostedDemo === 'boolean');
  const population = effectivePeople(facts, scenario, who);
  const hostPaid = who === 'host';

  const people = useMemo(
    () => (known ? keyPeopleOf(scenario, population, hostPaid) : []),
    [known, scenario, population, hostPaid],
  );
  const snapshot = useMemo(
    () => keyPeopleSnapshot(people, scenario.setup.defaultStartTime),
    [people, scenario.setup.defaultStartTime],
  );

  if (!known) {
    return (
      <section className={styles.panel} data-testid="shared-colony" data-loading>
        <div className={styles.grid}>
          <ColonyHeader figures={colonyFigures({ keyPeople: 5 })} loading />
          <div className={`${styles.frame} ${styles.cells}`} data-testid="colony-field" />
        </div>
        <p className={styles.caption} aria-hidden="true">
          <span className={styles.shape} data-shape>{colonyCaption({ leaders: size, population: 30, keyPeople: 5 })}</span>
        </p>
        <ColonyKey />
      </section>
    );
  }

  if (people.length === 0) {
    return (
      <section className={styles.panel} data-testid="shared-colony">
        <div className={styles.grid}>
          <ColonyHeader />
          <div className={styles.frame} data-testid="colony-field">
            <p className={styles.empty} data-text="body" data-testid="colony-empty">{NO_KEY_PEOPLE}</p>
          </div>
        </div>
        <ColonyKey />
      </section>
    );
  }

  return (
    <section className={styles.panel} data-testid="shared-colony">
      <div className={styles.grid}>
        <LivingSwarmGrid
          snapshot={snapshot}
          actorName={colonySpoken({ population, keyPeople: people.length })}
          actorArchetype=""
          startTime={scenario.setup.defaultStartTime}
          side="a"
          sideColor="var(--vis)"
          mode="living"
          initialPopulation={population}
          header={<ColonyHeader figures={colonyFigures({ keyPeople: people.length })} />}
          nameLabels="featured"
          resting
        />
      </div>
      <p className={styles.caption} data-testid="colony-caption">
        {colonyCaption({ leaders: size, population, keyPeople: people.length })}
      </p>
      <ColonyKey />
    </section>
  );
}
