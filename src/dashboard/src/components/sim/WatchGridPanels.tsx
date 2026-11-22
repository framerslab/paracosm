/**
 * The living grid on the Sim tab: each leader's own colony, drawn from the
 * run's latest roster, above the turn rows.
 *
 * Before a run the Run tab draws the colony once, since every leader starts
 * from the same people. Once the run sends its first roster the colonies
 * are each leader's own, and this is where they show:
 *
 * - A pair: two panels, the first leader's in the grid's amber (`--vis`)
 *   and the second's in its teal (`--eng`), side by side from a tablet up
 *   and stacked on a phone.
 * - 3 to 300 leaders: the track of one compact panel a leader, which mounts
 *   a panel's grid when the panel first comes into view.
 *
 * Each panel is the Viz tab's own grid, playing in its LIVING mode on the
 * newest turn each leader has reached, with the figures strip over it. The
 * Viz tab keeps the modes, the turn scrubber, the search and the forge
 * flares. Under reduced motion the grid itself draws each turn as one still
 * frame. Nothing is drawn until a roster has arrived.
 *
 * @module paracosm/dashboard/sim/WatchGridPanels
 */
import { useMemo } from 'react';
import { useScenarioContext } from '../../App';
import type { GameState, LeaderInfo } from '../../hooks/useGameState';
import { CohortSwarmGrid } from '../viz/CohortSwarmGrid';
import { DEFAULT_GRID_SETTINGS } from '../viz/grid/GridSettingsDrawer';
import { LivingSwarmGrid } from '../viz/grid/LivingSwarmGrid';
import { useVizSnapshots } from '../viz/useVizSnapshots';
import { alignToNewest, latestTurn } from './watch-grid.helpers';
import styles from './WatchGridPanels.module.scss';

/** The two sides of a pair: the grid's first colour and its second. */
const PAIR_SIDES = [
  { side: 'a', color: 'var(--vis)' },
  { side: 'b', color: 'var(--eng)' },
] as const;

/** A leader's six scores as the grid reads them; a score the run did not send reads as the middle. */
function hexacoOf(leader: LeaderInfo | null | undefined) {
  const h = leader?.hexaco;
  if (!h) return undefined;
  return {
    O: h.O ?? h.openness ?? 0.5,
    C: h.C ?? h.conscientiousness ?? 0.5,
    E: h.E ?? h.extraversion ?? 0.5,
    A: h.A ?? h.agreeableness ?? 0.5,
    Em: h.Em ?? h.emotionality ?? 0.5,
    HH: h.HH ?? h.honestyHumility ?? 0.5,
  };
}

export function WatchGridPanels({ state }: { state: GameState }) {
  const scenario = useScenarioContext();
  const snapshotMap = useVizSnapshots(state);
  const { actorIds } = state;
  const cohort = useMemo(() => alignToNewest(actorIds, snapshotMap), [actorIds, snapshotMap]);
  const startTime = scenario.setup?.defaultStartTime;

  // Nothing until a roster has arrived.
  if (!actorIds.some(id => (snapshotMap[id]?.length ?? 0) > 0)) return null;

  if (actorIds.length >= 3) {
    return (
      <div className={styles.track} data-testid="watch-grid-track">
        <CohortSwarmGrid
          state={state}
          snapshotMap={cohort.aligned}
          currentTurn={cohort.newest}
          gridMode="living"
          palette={0}
          gridSettings={DEFAULT_GRID_SETTINGS}
          searchQuery=""
          chronicleFilter="all"
          chronicleHover={null}
          startTime={startTime}
        />
      </div>
    );
  }

  const turns = [0, 1].map(index => latestTurn(snapshotMap[actorIds[index]]));

  return (
    <div className={styles.pair} data-testid="watch-grid">
      {PAIR_SIDES.map(({ side, color }, index) => {
        const id = actorIds[index];
        if (!id) return null;
        const snaps = snapshotMap[id] ?? [];
        const leader = state.actors[id]?.leader ?? null;
        const behind = turns[1 - index] - turns[index];
        return (
          <div key={id} className={styles.panel} data-testid="watch-grid-panel" data-place={index + 1}>
            <LivingSwarmGrid
              snapshot={snaps[snaps.length - 1]}
              previousSnapshot={snaps[snaps.length - 2]}
              snapshotHistory={snaps}
              actorName={leader?.name ?? id}
              actorArchetype={leader?.archetype ?? ''}
              leaderUnit={leader?.unit ?? ''}
              sideColor={color}
              side={side}
              lagTurns={behind > 0 ? behind : 0}
              mode="living"
              leaderHexaco={hexacoOf(leader)}
              startTime={startTime}
            />
          </div>
        );
      })}
    </div>
  );
}
