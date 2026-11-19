import { useEffect, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useToolContext, type ToolEntry } from '../../hooks/useToolRegistry';
import { useToolboxView } from './forgeViewContext';
import { CLOSE_TOOLBOX, EXPORT_JSON, TOOLBOX_FILE_NAME, TOOLBOX_TITLE, actorLabel, toolboxDialogName } from './forgeWords';
import { LookKey } from './LookKey';
import { ToolboxList, filterRows } from './ToolboxList';
import keys from './TraceDialog.module.scss';
import styles from './ToolboxDialog.module.scss';

export interface ToolboxDialogProps {
  /** A row's trace is open over the toolbox: the toolbox waits under it, and Escape closes that trace alone. */
  covered: boolean;
  onClose: () => void;
}

/**
 * The rows as Export JSON writes them: the fields the file has always held,
 * and the actor that holds each tool by its label and name, which tell two
 * actors' tools of one name apart.
 */
export function exportRows(rows: ToolEntry[]): Array<Record<string, unknown>> {
  return rows.map((e) => ({
    n: e.n,
    name: e.name,
    description: e.description,
    mode: e.mode,
    firstForgedTurn: e.firstForgedTurn,
    firstForgedDepartment: e.firstForgedDepartment,
    departments: [...e.departments],
    reuseCount: e.reuseCount,
    approved: e.approved,
    confidence: e.confidence,
    inputSchema: e.inputSchema,
    outputSchema: e.outputSchema,
    sampleOutput: e.sampleOutput,
    inputFields: e.inputFields,
    outputFields: e.outputFields,
    actor: actorLabel(e.actorIndex),
    actorName: e.actorName,
  }));
}

/** Saves the rows as a JSON file through a link the page presses itself. */
function downloadRows(rows: ToolEntry[]): void {
  const blob = new Blob([JSON.stringify(exportRows(rows), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = TOOLBOX_FILE_NAME;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The forged toolbox: a dialog over the run that lists every actor's tool,
 * each one press from its trace.
 *
 * Its header row holds Close, the title, Export JSON and the look key; on a
 * phone Export JSON is one full-width key at the list's foot. Export JSON
 * saves the rows shown, under the filter and the search as they stand.
 *
 * A full-screen sheet with its header row fixed on a phone, a centred
 * dialog 880 px wide from 900 px and 1200 px wide from 1440 px. It opens
 * with focus on its title, holds focus until it closes, and Escape closes
 * it. While a row's trace is open over it, it takes no key and no pointer.
 */
export function ToolboxDialog({ covered, onClose }: ToolboxDialogProps) {
  const registry = useToolContext();
  const { show, find } = useToolboxView();
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Under a row's trace, Escape is the trace's.
      if (e.key !== 'Escape' || e.defaultPrevented || coveredRef.current) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const exportShown = () => downloadRows(filterRows(registry.list, show, find));

  return (
    <div
      className={keys.backdrop}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={toolboxDialogName(registry.list.length)}
        tabIndex={-1}
        className={styles.dialog}
        inert={covered}
      >
        <div className={styles.header} data-toolbox-header>
          <button
            type="button"
            className={`${keys.key} ${keys.iconKey}`}
            onClick={() => onClose()}
            aria-label={CLOSE_TOOLBOX}
            title={CLOSE_TOOLBOX}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M3 3L13 13M13 3L3 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <h2 ref={titleRef} className={styles.title} tabIndex={-1} data-toolbox-title>{TOOLBOX_TITLE}</h2>
          <span className={styles.headerEnd}>
            <button type="button" className={`${keys.key} ${styles.exportInHeader}`} onClick={exportShown}>
              {EXPORT_JSON}
            </button>
            <LookKey />
          </span>
        </div>

        <div className={styles.body}>
          <ToolboxList />
        </div>

        <div className={styles.foot}>
          <button type="button" className={`${keys.key} ${styles.exportAtFoot}`} onClick={exportShown}>
            {EXPORT_JSON}
          </button>
        </div>
      </div>
    </div>
  );
}
