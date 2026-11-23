import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ProcessedEvent } from '../../hooks/useGameState';
import type { ToolEntry } from '../../hooks/useToolRegistry';
import { writeClipboardText } from '../../hooks/writeClipboardText';
import { sendForgeEvent } from '../../analytics/forgeEvents';
import { downloadJson } from '../../download';
import { RECORD_WORDS, recordFileName } from './forgeWords';
import styles from './stations/stations.module.scss';

/**
 * One actor's frames that name a tool, in stream order, each frame's data as
 * the Event Log lists it: a forge of the tool, or a department report whose
 * list of tools holds it. The page's own working field on a report
 * (`_filteredTools`) is left out, so the record is what the stream sent.
 */
export function recordFrames(events: readonly ProcessedEvent[], toolName: string): Array<Record<string, unknown>> {
  const name = toolName.trim();
  const named = (raw: unknown) => String(raw ?? '').trim() === name;
  const frames: Array<Record<string, unknown>> = [];
  for (const evt of events) {
    const d: Record<string, unknown> = evt.data ?? {};
    const forge = evt.type === 'forge_attempt' && named(d.name);
    const report = evt.type === 'specialist_done'
      && Array.isArray(d.forgedTools)
      && (d.forgedTools as unknown[]).some((t) => !!t && typeof t === 'object' && named((t as Record<string, unknown>).name));
    if (!forge && !report) continue;
    const data = { ...d };
    delete data._filteredTools;
    frames.push(data);
  }
  return frames;
}

/** The record as text, or null when it cannot be written out. */
function recordText(frames: unknown[]): string | null {
  try {
    return JSON.stringify(frames, null, 2);
  } catch {
    return null;
  }
}

type Said = 'copied' | 'copyFailed' | 'downloadFailed' | null;

/** How long "Copied" stays beside its key. */
const COPIED_FOR_MS = 5_000;

export interface RecordPanelProps {
  entry: ToolEntry;
  /** The actor's frames that name the tool, each frame's data (recordFrames). */
  frames: unknown[];
  /** Closes the trace and opens the Event Log on this actor's tool. */
  onShowInEventLog: () => void;
}

/**
 * What Record opens on a run with no trace: the run's record of one actor's
 * tool as the Event Log shows it, the frames that name the tool as JSON,
 * with Copy record, Download JSON and Show in Event Log. A copy or a
 * download that fails says so beside its key, with its way forward.
 */
export function RecordPanel({ entry, frames, onShowInEventLog }: RecordPanelProps) {
  const headingId = useId();
  const text = useMemo(() => recordText(frames), [frames]);
  const [said, setSaid] = useState<Said>(null);
  const clearRef = useRef<number | null>(null);
  /** Each copy is numbered, so a late answer to an earlier press says nothing. */
  const copyRef = useRef(0);

  useEffect(() => () => {
    if (clearRef.current !== null) window.clearTimeout(clearRef.current);
  }, []);

  const say = (next: Said) => {
    if (clearRef.current !== null) window.clearTimeout(clearRef.current);
    clearRef.current = null;
    setSaid(next);
    if (next === 'copied') clearRef.current = window.setTimeout(() => setSaid(null), COPIED_FOR_MS);
  };

  const copy = () => {
    if (text === null) return;
    sendForgeEvent({ name: 'forge_record_export', what: 'record_copy' });
    const press = ++copyRef.current;
    writeClipboardText(text).then(
      () => { if (press === copyRef.current) say('copied'); },
      () => { if (press === copyRef.current) say('copyFailed'); },
    );
  };

  const download = () => {
    if (text === null) return;
    sendForgeEvent({ name: 'forge_record_export', what: 'record_download' });
    try {
      downloadJson(text, recordFileName(entry.name));
      say(null);
    } catch {
      say('downloadFailed');
    }
  };

  const words: Record<Exclude<Said, null>, string> = {
    copied: RECORD_WORDS.copied,
    copyFailed: RECORD_WORDS.copyFailed,
    downloadFailed: RECORD_WORDS.downloadFailed,
  };

  return (
    <section className={styles.open} data-record-panel aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.heading} data-text="heading">{RECORD_WORDS.rawRecord}</h3>
      {text === null ? (
        <>
          <p className={styles.body} data-text="body">{RECORD_WORDS.unreadable}</p>
          <div className={styles.recordKeys}>
            <button type="button" className={styles.switch} onClick={onShowInEventLog}>{RECORD_WORDS.showInEventLog}</button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.recordKeys}>
            <button type="button" className={styles.switch} onClick={copy}>{RECORD_WORDS.copy}</button>
            <button type="button" className={styles.switch} onClick={download}>{RECORD_WORDS.download}</button>
            <button type="button" className={styles.switch} onClick={onShowInEventLog}>{RECORD_WORDS.showInEventLog}</button>
            <p className={styles.recordSaid} role="status">
              {said ? words[said] : null}
            </p>
          </div>
          <pre
            className={styles.record}
            data-raw-record
            translate="no"
            tabIndex={0}
            aria-label={RECORD_WORDS.rawRecord}
          >
            {text}
          </pre>
        </>
      )}
    </section>
  );
}
