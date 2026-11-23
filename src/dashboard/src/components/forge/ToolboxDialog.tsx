import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { sendForgeEvent } from '../../analytics/forgeEvents';
import { downloadJson } from '../../download';
import { useToolContext, type ToolEntry } from '../../hooks/useToolRegistry';
import { pickedActors } from './actorPicker.helpers';
import { useToolboxView } from './forgeViewContext';
import {
  CLOSE_TOOLBOX,
  EXPORT_FAILED,
  EXPORT_JSON,
  TOOLBOX_FILE_NAME,
  TOOLBOX_TITLE,
  actorLabel,
  exportingTools,
  toolboxDialogName,
} from './forgeWords';
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

/** Past this many rows, Export JSON says it is exporting while it writes the file. */
const EXPORT_NOTICE_PAST = 500;

/** What Export JSON says: nothing, that it is writing a file of this many tools, or that it failed. */
type ExportStatus = { state: 'idle' } | { state: 'exporting'; tools: number } | { state: 'failed' };

/**
 * The forged toolbox: a dialog over the run that lists every actor's tool,
 * each one press from its trace.
 *
 * Its header row holds Close, the title, Export JSON and the look key; on a
 * phone Export JSON is one full-width key at the list's foot. Export JSON
 * saves the rows shown, under the filter, the search and the chosen actors as
 * they stand, whatever their folds. Past 500 rows it says "Exporting {tools}
 * tools…" beside the key while it writes the file, and "Could not export.
 * Try again." when the file could not be made.
 *
 * A full-screen sheet with its header row fixed on a phone, a centred
 * dialog 880 px wide from 900 px and 1200 px wide from 1440 px. It opens
 * with focus on its title, holds focus until it closes, and Escape closes
 * it. While a row's trace is open over it, it takes no key and no pointer.
 */
export function ToolboxDialog({ covered, onClose }: ToolboxDialogProps) {
  const registry = useToolContext();
  const { show, find, actors } = useToolboxView();
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

  const [exported, setExported] = useState<ExportStatus>({ state: 'idle' });
  const exportShown = () => {
    sendForgeEvent({ name: 'forge_record_export', what: 'toolbox' });
    const rows = filterRows(registry.list, show, find, pickedActors(actors, registry.actors.length));
    const save = () => {
      try {
        downloadJson(JSON.stringify(exportRows(rows), null, 2), TOOLBOX_FILE_NAME);
        setExported({ state: 'idle' });
      } catch {
        setExported({ state: 'failed' });
      }
    };
    if (rows.length <= EXPORT_NOTICE_PAST) {
      save();
      return;
    }
    // The status shows before the file is written: the page paints it, then writes.
    setExported({ state: 'exporting', tools: rows.length });
    requestAnimationFrame(() => { window.setTimeout(save, 0); });
  };
  const exportSays = exported.state === 'exporting'
    ? exportingTools(exported.tools)
    : exported.state === 'failed' ? EXPORT_FAILED : '';

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
          <h2 ref={titleRef} className={styles.title} tabIndex={-1} data-toolbox-title data-text="heading">{TOOLBOX_TITLE}</h2>
          <span className={styles.headerEnd}>
            <button type="button" className={`${keys.key} ${styles.exportInHeader}`} onClick={exportShown}>
              {EXPORT_JSON}
            </button>
            <LookKey />
          </span>
          <span className={styles.exportStatus} role="status" data-export-status>{exportSays}</span>
        </div>

        <div className={styles.body}>
          <ToolboxList />
        </div>

        <div className={styles.foot}>
          <p className={styles.footStatus} role="status" data-export-status>{exportSays}</p>
          <button type="button" className={`${keys.key} ${styles.exportAtFoot}`} onClick={exportShown}>
            {EXPORT_JSON}
          </button>
        </div>
      </div>
    </div>
  );
}
