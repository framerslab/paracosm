import type { CSSProperties } from 'react';
import type { CellSnapshot } from './viz-types.js';
import { DEPARTMENT_COLORS, DEFAULT_DEPT_COLOR } from './viz-types.js';
import styles from './FamilyTree.module.scss';

interface FamilyTreeProps {
  center: CellSnapshot;
  byId: Map<string, CellSnapshot>;
  onSelect: (agentId: string) => void;
}

function Thumb({ cell, onSelect, relation }: { cell: CellSnapshot; onSelect: (id: string) => void; relation: string }) {
  const color = DEPARTMENT_COLORS[cell.department] ?? DEFAULT_DEPT_COLOR;
  return (
    <button
      type="button"
      onClick={() => onSelect(cell.agentId)}
      aria-label={`${relation}: ${cell.name}`}
      className={[styles.thumb, cell.alive ? '' : styles.deceased].filter(Boolean).join(' ')}
    >
      <span
        className={styles.swatch}
        style={{ '--dept-color': color } as CSSProperties}
      />
      <span className={styles.name}>{cell.name}</span>
      <span className={styles.relation}>{relation}</span>
    </button>
  );
}

/**
 * Clickable family thumbnails. Click any thumb to swap the drilldown
 * panel content to that colonist. Missing references (partner or
 * child not in the snapshot) render nothing rather than placeholder.
 */
export function FamilyTree({ center, byId, onSelect }: FamilyTreeProps) {
  const partner = center.partnerId ? byId.get(center.partnerId) : null;
  const children = center.childrenIds.map(id => byId.get(id)).filter((c): c is CellSnapshot => !!c);
  if (!partner && children.length === 0) {
    return <div className={styles.empty}>No listed family.</div>;
  }
  return (
    <div className={styles.list}>
      {partner && <Thumb cell={partner} onSelect={onSelect} relation="partner" />}
      {children.slice(0, 4).map(c => (
        <Thumb key={c.agentId} cell={c} onSelect={onSelect} relation="child" />
      ))}
      {children.length > 4 && (
        <div className={styles.more}>+{children.length - 4} more children</div>
      )}
    </div>
  );
}
