import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { CellSnapshot, TurnSnapshot } from '../viz-types.js';
import { HexacoRadar } from '../HexacoRadar.js';
import { useMediaQuery, PHONE_QUERY } from './useMediaQuery.js';
import styles from './ClickPopover.module.scss';

interface HexacoShape { O: number; C: number; E: number; A: number; Em: number; HH: number }

export interface ClickPopoverPayload {
  cell: CellSnapshot;
  /** Anchor coordinates in overlay-canvas pixel space. */
  x: number;
  y: number;
}

interface ClickPopoverProps {
  payload: ClickPopoverPayload | null;
  /** Container size so the popover can flip when near an edge. */
  containerW: number;
  containerH: number;
  sideColor: string;
  hexacoById?: Map<string, HexacoShape>;
  snapshots?: TurnSnapshot[];
  onClose: () => void;
  onOpenChat?: (name: string) => void;
}

const HEXACO_LABELS: Record<keyof HexacoShape, string> = {
  O: 'Openness',
  C: 'Conscientiousness',
  E: 'Extraversion',
  A: 'Agreeableness',
  Em: 'Emotionality',
  HH: 'Honesty-Humility',
};

function topHexacoAxes(h: HexacoShape | undefined): string {
  if (!h) return '';
  const entries = Object.entries(h) as Array<[keyof HexacoShape, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  return entries
    .slice(0, 2)
    .map(([k, v]) => `${HEXACO_LABELS[k]} ${v.toFixed(2)}`)
    .join(' · ');
}

/**
 * Floating colonist drilldown popover. Anchored near the clicked glyph
 * with viewport-aware placement (auto-flip left/up when near edge).
 * Shows identity, HEXACO radar, mood+psych, family, memory quotes,
 * click-to-chat. Dismissible via Esc, close button, or backdrop click.
 */
export function ClickPopover(props: ClickPopoverProps) {
  const {
    payload,
    containerW,
    containerH,
    sideColor,
    hexacoById,
    snapshots,
    onClose,
    onOpenChat,
  } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!payload) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [payload, onClose]);

  const hexaco = useMemo(() => {
    if (!payload || !hexacoById) return undefined;
    return hexacoById.get(payload.cell.agentId) ?? hexacoById.get(payload.cell.name);
  }, [payload, hexacoById]);

  const memoryQuotes = useMemo(() => {
    if (!payload) return [] as string[];
    const out: string[] = [...(payload.cell.shortTermMemory ?? [])];
    if (snapshots) {
      for (let i = snapshots.length - 1; i >= 0 && out.length < 3; i--) {
        const found = snapshots[i].cells.find(c => c.agentId === payload.cell.agentId);
        if (!found) continue;
        for (const q of found.shortTermMemory ?? []) {
          if (q && !out.includes(q)) out.push(q);
          if (out.length >= 3) break;
        }
      }
    }
    return out.slice(0, 3);
  }, [payload, snapshots]);

  const phone = useMediaQuery(PHONE_QUERY);
  if (!payload) return null;

  // On phones the popover takes nearly full panel width; on desktop it
  // floats next to the clicked glyph with smart edge-flip.
  const POP_W = phone ? Math.min(320, containerW - 16) : 320;
  const POP_H_EST = Math.min(360, containerH - 20);
  const margin = 10;
  const left = phone
    ? Math.max(8, (containerW - POP_W) / 2)
    : (payload.x + POP_W + margin > containerW
        ? Math.max(margin, payload.x - POP_W - margin)
        : Math.min(containerW - POP_W - margin, payload.x + margin));
  const top = phone
    ? Math.max(8, (containerH - POP_H_EST) / 2)
    : (payload.y - POP_H_EST - margin < 0
        ? Math.min(containerH - POP_H_EST - margin, payload.y + margin)
        : Math.max(margin, payload.y - POP_H_EST - margin));

  const cell = payload.cell;
  const morale = typeof cell.psychScore === 'number' ? Math.round(cell.psychScore * 100) : null;
  const generationLabel = (() => {
    const g = cell.generation ?? 0;
    if (g === 0) return 'Earth-born';
    if (g === 1) return 'First-native';
    return `Gen ${g}`;
  })();

  // Cap max-height to the space remaining below `top` within the
  // canvasWrap. `canvasWrap` has overflow:hidden, so a popover positioned
  // at `top` with max-height = containerH - margin*2 would extend past
  // the bottom edge whenever top > margin and the parent's clip would
  // hide the chat button + memory tail with no way for the popover's
  // internal overflow:auto to reveal it. Floor at 120px so a click in
  // the very-bottom row still produces a usable card (it'll flip down
  // via the positioning logic above when there's room).
  const popMaxHeight = Math.max(120, containerH - top - margin);
  const popStyle = {
    '--side-color': sideColor,
    '--pop-left': `${left}px`,
    '--pop-top': `${top}px`,
    '--pop-width': `${POP_W}px`,
    '--pop-max-height': `${popMaxHeight}px`,
  } as CSSProperties;

  return (
    <>
      <div onClick={onClose} className={styles.backdrop} />
      <div
        ref={rootRef}
        role="dialog"
        aria-label={`${cell.name} drilldown`}
        className={styles.popover}
        style={popStyle}
      >
        <div className={styles.headerRow}>
          <div>
            <div className={styles.headerName}>{cell.name}</div>
            <div className={styles.headerSubline}>
              {cell.role} · {cell.rank}
              {cell.featured && (
                <span className={styles.featuredPill}>FEATURED</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drilldown"
            className={styles.closeBtn}
          >
            ×
          </button>
        </div>

        <div className={styles.section}>
          <div className={styles.statsGrid}>
            <span className={styles.statKey}>DEPT</span>
            <span className={styles.statValueUpper}>{cell.department}</span>
            <span className={styles.statKey}>AGE</span>
            <span className={styles.statValue}>{cell.age ?? '—'}</span>
            <span className={styles.statKey}>MOOD</span>
            <span className={styles.statValue}>{cell.mood}</span>
            {morale !== null && (
              <>
                <span className={styles.statKey}>PSYCH</span>
                <span className={styles.statValue}>{morale}%</span>
              </>
            )}
            <span className={styles.statKey}>ORIGIN</span>
            <span className={styles.statValue}>{generationLabel}</span>
            <span className={styles.statKey}>PARTNER</span>
            <span className={styles.statValue}>
              {cell.partnerId ? 'yes' : '—'}
            </span>
            <span className={styles.statKey}>CHILDREN</span>
            <span className={styles.statValue}>{cell.childrenIds?.length ?? 0}</span>
          </div>
        </div>

        {hexaco && (
          <div className={styles.section}>
            <div className={styles.sectionLabel}>HEXACO</div>
            <div className={styles.hexacoRow}>
              <div className={styles.hexacoRadarWrap}>
                <HexacoRadar profile={hexaco} size={120} />
              </div>
              <div className={styles.hexacoTopAxes}>
                {topHexacoAxes(hexaco)}
              </div>
            </div>
          </div>
        )}

        {memoryQuotes.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Recent memory</div>
            <ul className={styles.memoryList}>
              {memoryQuotes.map((q, i) => (
                <li key={i} className={styles.memoryItem}>
                  "{q}"
                </li>
              ))}
            </ul>
          </div>
        )}

        {onOpenChat && (
          <div className={styles.sectionLast}>
            <button
              type="button"
              onClick={() => onOpenChat(cell.name)}
              className={styles.chatBtn}
            >
              Open chat with {cell.name.split(' ')[0]}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
