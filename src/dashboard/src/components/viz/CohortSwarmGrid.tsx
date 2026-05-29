/**
 * Cohort viz mode: a horizontally-scrolling track of compact
 * LivingSwarmGrid instances, one per actor in the run. Sits next to the
 * pair-mode 2-panel view as an alternative selectable from the toolbar
 * (only available for 3+ actor cohort runs).
 *
 * Layout
 * - Each actor gets a column with a sticky header (slot index + name +
 *   archetype) and a fixed-width LivingSwarmGrid below.
 * - The outer track scrolls horizontally with a visible scrollbar so
 *   users discover that more actors live past the viewport edge.
 * - Cell columns past the visible viewport stay mounted but skip
 *   LivingSwarmGrid render until first intersection (lazy hydrate);
 *   once mounted they stay rendered so the play-through animation
 *   doesn't restart on each scroll-back.
 *
 * Pair-only features (divergence overlay, sibling hover sympathy ring,
 * focus-side fullscreen toggle, A-vs-B diff classification) are
 * intentionally absent here — they don't generalise across N actors
 * and the pair-mode panel keeps them when the user toggles back.
 *
 * @module paracosm/dashboard/viz/CohortSwarmGrid
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LivingSwarmGrid } from './grid/LivingSwarmGrid';
import type { GridMode } from './grid/GridModePills';
import type { GridSettings } from './grid/GridSettingsDrawer';
import { getActorColorVar } from '../../hooks/useGameState';
import type { GameState, ProcessedEvent } from '../../hooks/useGameState';
import type { TurnSnapshot } from './viz-types';
import styles from './CohortSwarmGrid.module.scss';

interface HexacoShape {
  O: number;
  C: number;
  E: number;
  A: number;
  Em: number;
  HH: number;
}

interface CohortSwarmGridProps {
  state: GameState;
  snapshotMap: Record<string, TurnSnapshot[]>;
  currentTurn: number;
  gridMode: GridMode;
  palette: 0 | 1 | 2;
  gridSettings: GridSettings;
  hexacoById?: Map<string, HexacoShape>;
  searchQuery: string;
  chronicleFilter: 'all' | 'birth' | 'death' | 'forge' | 'crisis';
  chronicleHover: { kind: 'birth' | 'death' | 'forge' | 'crisis'; side: 'a' | 'b'; turn: number } | null;
  startTime?: number;
  onOpenChat?: (colonistName: string) => void;
}

interface ForgeAttempt {
  turn: number;
  eventIndex: number;
  department: string;
  name: string;
  approved: boolean;
  confidence?: number;
}

interface ReuseCall {
  turn: number;
  originDept: string;
  callingDept: string;
  name: string;
}

/**
 * Per-actor forge feed derivation. Mirrors the inline logic in
 * `SwarmViz.tsx`'s `forgeFeeds` memo but scoped to one actor's event
 * list. Kept in this file (rather than extracted to a shared helper)
 * because SwarmViz still owns the pair-mode A/B-keyed feed for the
 * downstream EventChronicle widget, and untangling that callsite for
 * a small DRY win wasn't worth the regression surface.
 */
function buildForgeFeedFor(events: ProcessedEvent[]): { attempts: ForgeAttempt[]; reuses: ReuseCall[] } {
  const attempts: ForgeAttempt[] = [];
  const reuses: ReuseCall[] = [];
  const firstByName = new Map<string, string>();
  for (const evt of events) {
    if (evt.type === 'forge_attempt') {
      const d = evt.data || {};
      // Anthropic SSE payloads sometimes serialize the boolean as the
      // string 'true' instead of `true`; the dashboard accepts both.
      // Compute the normalized value once and reuse it for both the
      // attempts entry and the firstByName lookup so they can't drift.
      const isApproved = d.approved === true || d.approved === 'true';
      attempts.push({
        turn: Number(d.turn ?? 0),
        eventIndex: Number(d.eventIndex ?? 0),
        department: String(d.department || ''),
        name: String(d.name || ''),
        approved: isApproved,
        confidence: typeof d.confidence === 'number' ? d.confidence : undefined,
      });
      if (d.name && d.department && isApproved && !firstByName.has(String(d.name))) {
        firstByName.set(String(d.name), String(d.department));
      }
      continue;
    }
    if (evt.type !== 'specialist_done') continue;
    const d = evt.data || {};
    const dept = String(d.department || '');
    const tools = Array.isArray(d.forgedTools) ? d.forgedTools : [];
    for (const t of tools) {
      const tt = t as Record<string, unknown>;
      const name = String(tt.name || '');
      if (!name || name === 'unnamed') continue;
      const firstDept = typeof tt.firstForgedDepartment === 'string'
        ? String(tt.firstForgedDepartment)
        : firstByName.get(name);
      const firstTurn = typeof tt.firstForgedTurn === 'number'
        ? (tt.firstForgedTurn as number)
        : undefined;
      const thisTurn = Number(evt.turn ?? d.turn ?? 0);
      if (firstDept && firstTurn !== undefined && firstTurn < thisTurn) {
        reuses.push({ turn: thisTurn, originDept: firstDept, callingDept: dept, name });
      } else if (firstDept && firstDept !== dept) {
        reuses.push({ turn: thisTurn, originDept: firstDept, callingDept: dept, name });
      }
    }
  }
  return { attempts, reuses };
}

/**
 * One actor's column in the cohort track. Each column does its own
 * IntersectionObserver-based lazy mount: until the column enters the
 * viewport (with a small rootMargin so the user doesn't see a blank
 * cell pop in mid-scroll), the LivingSwarmGrid stays unrendered and
 * a low-cost placeholder is shown instead. Once mounted, the column
 * keeps the LivingSwarmGrid alive so scrolling away + back doesn't
 * blow away the canvas animation state.
 */
interface CohortColumnProps {
  actorIndex: number;
  actorId: string;
  state: GameState;
  snaps: TurnSnapshot[];
  currentTurn: number;
  gridMode: GridMode;
  palette: 0 | 1 | 2;
  gridSettings: GridSettings;
  hexacoById?: Map<string, HexacoShape>;
  searchQuery: string;
  chronicleFilter: 'all' | 'birth' | 'death' | 'forge' | 'crisis';
  chronicleHover: { kind: 'birth' | 'death' | 'forge' | 'crisis'; side: 'a' | 'b'; turn: number } | null;
  startTime?: number;
  onOpenChat?: (colonistName: string) => void;
}

function CohortColumn(props: CohortColumnProps) {
  const {
    actorIndex,
    actorId,
    state,
    snaps,
    currentTurn,
    gridMode,
    palette,
    gridSettings,
    hexacoById,
    searchQuery,
    chronicleFilter,
    chronicleHover,
    startTime,
    onOpenChat,
  } = props;

  const ref = useRef<HTMLDivElement | null>(null);
  // Track whether the column has been visible at least once. Once true
  // we keep the LivingSwarmGrid mounted forever (canvas animation
  // state would reset if we unmounted on scroll-away).
  const [hasBeenVisible, setHasBeenVisible] = useState(actorIndex < 4);

  useEffect(() => {
    if (hasBeenVisible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Older browsers: mount eagerly.
      setHasBeenVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setHasBeenVisible(true);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin: '240px 360px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasBeenVisible]);

  const sideState = state.actors[actorId] ?? null;
  const leader = sideState?.leader ?? null;
  const snap = snaps[currentTurn];
  const prevSnap = currentTurn > 0 ? snaps[currentTurn - 1] : undefined;
  const sideColor = getActorColorVar(actorIndex);
  // 1-based numeric fallback so cohorts past 26 actors don't render
  // non-letter ASCII glitches where the slot label should go. The
  // ActorBar slot pill carries the proper A/B/…/AA/AB Excel-style label
  // separately when alphabetic identity matters.
  const fallbackName = leader?.name || `Leader ${actorIndex + 1}`;
  const forge = useMemo(() => {
    if (!sideState) return { attempts: [], reuses: [] };
    return buildForgeFeedFor(sideState.events);
  }, [sideState]);

  const leaderHexaco: HexacoShape | undefined = leader?.hexaco
    ? {
        O: leader.hexaco.O ?? leader.hexaco.openness ?? 0.5,
        C: leader.hexaco.C ?? leader.hexaco.conscientiousness ?? 0.5,
        E: leader.hexaco.E ?? leader.hexaco.extraversion ?? 0.5,
        A: leader.hexaco.A ?? leader.hexaco.agreeableness ?? 0.5,
        Em: leader.hexaco.Em ?? leader.hexaco.emotionality ?? 0.5,
        HH: leader.hexaco.HH ?? leader.hexaco.honestyHumility ?? 0.5,
      }
    : undefined;

  return (
    <div
      ref={ref}
      className={styles.column}
      style={{ ['--actor-color' as string]: sideColor } as CSSProperties}
      aria-label={`Living swarm grid for actor ${actorIndex + 1}: ${fallbackName}`}
    >
      <header className={styles.columnHeader}>
        <span className={styles.columnHeaderSlot}>A{actorIndex + 1}</span>
        <div className={styles.columnHeaderText}>
          <span className={styles.columnHeaderName}>{fallbackName}</span>
          {leader?.archetype && (
            <span className={styles.columnHeaderArchetype}>{leader.archetype}</span>
          )}
        </div>
        <span className={styles.columnHeaderPop} title="Population alive · morale">
          {snap?.population ?? '—'} · {snap ? Math.round(snap.morale * 100) : '—'}%
        </span>
      </header>

      <div className={styles.columnBody}>
        {hasBeenVisible ? (
          <LivingSwarmGrid
            snapshot={snap}
            isLiveRun={state.isRunning}
            previousSnapshot={prevSnap}
            snapshotHistory={snaps}
            actorName={fallbackName}
            actorArchetype={leader?.archetype ?? ''}
            leaderUnit={leader?.unit ?? ''}
            sideColor={sideColor}
            // Cohort mode does not support pair-only sibling sympathy,
            // divergence overlay, or focus-toggle, so we pass `side='a'`
            // for every column and the downstream canvas treats them
            // all as independent panels. The slot color sourced from
            // `getActorColorVar` carries the per-actor identity instead.
            side="a"
            mode={gridMode}
            hexacoById={hexacoById}
            leaderHexaco={leaderHexaco}
            forgeAttempts={forge.attempts}
            reuseCalls={forge.reuses}
            searchQuery={searchQuery}
            palette={palette}
            settings={gridSettings}
            startTime={startTime}
            onOpenChat={onOpenChat}
            eventFilter={chronicleFilter}
            chronicleHover={chronicleHover}
          />
        ) : (
          <div className={styles.columnPlaceholder} aria-hidden="true">
            <div className={styles.columnPlaceholderShimmer} />
            <span className={styles.columnPlaceholderLabel}>Loading swarm…</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function CohortSwarmGrid({
  state,
  snapshotMap,
  currentTurn,
  gridMode,
  palette,
  gridSettings,
  hexacoById,
  searchQuery,
  chronicleFilter,
  chronicleHover,
  startTime,
  onOpenChat,
}: CohortSwarmGridProps) {
  const actorIds = state.actorIds;
  return (
    <div
      className={styles.track}
      role="region"
      aria-label={`Cohort swarm grid: ${actorIds.length} actors`}
    >
      <div className={styles.trackInner}>
        {actorIds.map((actorId, idx) => (
          <CohortColumn
            key={actorId}
            actorId={actorId}
            actorIndex={idx}
            state={state}
            snaps={snapshotMap[actorId] ?? []}
            currentTurn={currentTurn}
            gridMode={gridMode}
            palette={palette}
            gridSettings={gridSettings}
            hexacoById={hexacoById}
            searchQuery={searchQuery}
            chronicleFilter={chronicleFilter}
            chronicleHover={chronicleHover}
            startTime={startTime}
            onOpenChat={onOpenChat}
          />
        ))}
      </div>
    </div>
  );
}
