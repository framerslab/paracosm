import { useEffect, useRef, useState } from 'react';
import {
  createFlareQueue,
  pushFlare,
  tickFlares,
  activeFlares,
  type FlareQueue,
  type ActiveFlare,
} from './flareQueue.js';
import type { TurnSnapshot, GridPosition } from '../viz-types.js';
import { useMediaQuery, REDUCED_MOTION_QUERY } from './useMediaQuery.js';

export interface ForgeAttempt {
  turn: number;
  eventIndex: number;
  department: string;
  name: string;
  approved: boolean;
  confidence?: number;
}

export interface ReuseCall {
  turn: number;
  originDept: string;
  callingDept: string;
  name: string;
}

interface UseGridStateInputs {
  snapshot: TurnSnapshot | undefined;
  previousSnapshot: TurnSnapshot | undefined;
  /** Cumulative forge attempts for this side. Hook de-duplicates. */
  forgeAttempts?: ForgeAttempt[];
  /** Cumulative reuse calls. Hook de-duplicates. */
  reuseCalls?: ReuseCall[];
  /** Event categories fired this turn (used for crisis flares). */
  eventCategories?: string[];
}

interface GridStateHandle {
  flares: ActiveFlare[];
  tickClock: number;
}

const CRISIS_CATEGORIES = new Set([
  'political',
  'social',
  'infrastructure',
  'medical',
  'resource',
  'environmental',
]);

/**
 * Owns the per-leader flare queue and a monotonic frame counter that
 * the renderer reads each rAF tick. Seeds flares from:
 *   - Birth events (colonists newly present since last snapshot)
 *   - Death events (colonists who died between snapshots)
 *   - Forge attempts (approved + rejected)
 *   - Reuse calls (origin dept → calling dept arc)
 *   - Crisis events (category-gated, fires at colony center)
 * Pauses on visibilitychange / off-screen.
 */
export function useGridState(
  inputs: UseGridStateInputs,
  containerRef: React.RefObject<HTMLElement | null>,
  positionLookup: () => Map<string, GridPosition>,
  deptCenterLookup?: () => Map<string, GridPosition>,
): GridStateHandle {
  const flareQueueRef = useRef<FlareQueue>(createFlareQueue());
  const seenKeysRef = useRef<Set<string>>(new Set());
  const [tickClock, setTickClock] = useState(0);
  const prevTurnRef = useRef<number>(-1);
  const onScreenRef = useRef(true);
  const tabVisibleRef = useRef(
    typeof document !== 'undefined' ? !document.hidden : true,
  );
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);

  // Births / deaths — diffed from snapshot ↔ previousSnapshot each turn.
  useEffect(() => {
    const snap = inputs.snapshot;
    const prev = inputs.previousSnapshot;
    if (!snap) return;
    if (snap.turn === prevTurnRef.current) return;
    prevTurnRef.current = snap.turn;

    if (!prev) return;
    const positions = positionLookup();

    const prevIds = new Set(prev.cells.map(c => c.agentId));
    const currIds = new Set(snap.cells.map(c => c.agentId));

    for (const c of snap.cells) {
      if (!prevIds.has(c.agentId) && c.alive) {
        const pos = positions.get(c.agentId);
        if (pos) {
          pushFlare(flareQueueRef.current, {
            kind: 'birth',
            x: pos.x,
            y: pos.y,
            totalFrames: 30,
            sourceId: c.agentId,
          });
        }
      }
    }
    for (const prevCell of prev.cells) {
      const curr = snap.cells.find(c => c.agentId === prevCell.agentId);
      const died =
        (curr && prevCell.alive && !curr.alive) ||
        (prevCell.alive && !currIds.has(prevCell.agentId));
      if (died) {
        const pos = positions.get(prevCell.agentId);
        if (pos) {
          pushFlare(flareQueueRef.current, {
            kind: 'death',
            x: pos.x,
            y: pos.y,
            totalFrames: 60,
            sourceId: prevCell.agentId,
          });
        }
      }
    }

    // Crisis flares from event categories. One per category, once per
    // turn, anchored at the overall cluster centroid.
    const cats = inputs.eventCategories ?? snap.eventCategories ?? [];
    if (cats.length > 0) {
      const allPositions = Array.from(positions.values());
      if (allPositions.length > 0) {
        const cx =
          allPositions.reduce((a, b) => a + b.x, 0) / allPositions.length;
        const cy =
          allPositions.reduce((a, b) => a + b.y, 0) / allPositions.length;
        for (const raw of cats) {
          const cat = raw.toLowerCase();
          if (!CRISIS_CATEGORIES.has(cat)) continue;
          const key = `crisis|${snap.turn}|${cat}`;
          if (seenKeysRef.current.has(key)) continue;
          seenKeysRef.current.add(key);
          pushFlare(flareQueueRef.current, {
            kind: 'crisis',
            x: cx,
            y: cy,
            totalFrames: 90,
          });
        }
      }
    }
  }, [inputs.snapshot, inputs.previousSnapshot, inputs.eventCategories, positionLookup]);

  // Forge + reuse — fire whenever new cumulative entries land (not just
  // at turn_done, since the runtime can stream forge events mid-turn).
  useEffect(() => {
    if (!deptCenterLookup) return;
    const centers = deptCenterLookup();
    if (centers.size === 0) return;

    for (const att of inputs.forgeAttempts ?? []) {
      const key = `forge|${att.turn}|${att.eventIndex}|${att.department}|${att.name}|${att.approved ? 'a' : 'r'}`;
      if (seenKeysRef.current.has(key)) continue;
      seenKeysRef.current.add(key);
      const center = centers.get((att.department || 'unknown').toLowerCase());
      if (!center) continue;
      pushFlare(flareQueueRef.current, {
        kind: att.approved ? 'forge_approved' : 'forge_rejected',
        x: center.x,
        y: center.y,
        totalFrames: att.approved ? 30 : 22,
      });
    }
    for (const reuse of inputs.reuseCalls ?? []) {
      const key = `reuse|${reuse.turn}|${reuse.originDept}|${reuse.callingDept}|${reuse.name}`;
      if (seenKeysRef.current.has(key)) continue;
      seenKeysRef.current.add(key);
      const origin = centers.get((reuse.originDept || 'unknown').toLowerCase());
      const calling = centers.get((reuse.callingDept || 'unknown').toLowerCase());
      if (!origin || !calling) continue;
      pushFlare(flareQueueRef.current, {
        kind: 'reuse',
        x: origin.x,
        y: origin.y,
        endX: calling.x,
        endY: calling.y,
        totalFrames: 40,
      });
    }
  }, [inputs.forgeAttempts, inputs.reuseCalls, deptCenterLookup]);

  // Visibility + intersection → pause.
  useEffect(() => {
    const onVis = () => {
      tabVisibleRef.current = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVis);
    const el = containerRef.current;
    let io: IntersectionObserver | null = null;
    if (el) {
      io = new IntersectionObserver(
        entries => {
          for (const e of entries) onScreenRef.current = e.isIntersecting;
        },
        { threshold: 0 },
      );
      io.observe(el);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
    };
  }, [containerRef]);

  // rAF tick — bumps tickClock, advances flares. Under reduced motion
  // the animation loop is suppressed; render still happens on snapshot
  // change via a single bump below.
  useEffect(() => {
    if (reducedMotion) {
      // One render per snapshot change is enough under reduced motion;
      // bump tickClock so the canvas paints the current state.
      setTickClock(prev => prev + 1);
      return;
    }
    let raf = 0;
    let lastMs = performance.now();
    const minFrame = 1000 / 30;
    const loop = (nowMs: number) => {
      if (!onScreenRef.current || !tabVisibleRef.current) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const delta = nowMs - lastMs;
      if (delta < minFrame) {
        raf = requestAnimationFrame(loop);
        return;
      }
      lastMs = nowMs;
      tickFlares(flareQueueRef.current);
      setTickClock(prev => prev + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  return { flares: activeFlares(flareQueueRef.current), tickClock };
}
