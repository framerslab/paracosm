import { useState, useCallback, useEffect, type MouseEvent, type ReactNode } from 'react';
import type { CitationRegistry } from '../../hooks/useCitationRegistry';
import type { ToolRegistry } from '../../hooks/useToolRegistry';
import { useForgeView } from '../forge/ForgeViewProvider';
import { ReferencesList } from '../shared/ReferencesSection';
import { OneRowScroller } from '../shared/OneRowScroller';
import styles from './SimFooterBar.module.scss';

interface SimFooterBarProps {
  citationRegistry: CitationRegistry;
  toolRegistry: ToolRegistry;
  /** Optional inline slot rendered after the FORGED TOOLBOX CTA, before
   *  the spacer/hint. Used by SimView to host the SIM layout toggle
   *  (side-by-side / constellation) so it sits with the bottom evidence
   *  bar instead of taking its own row above the leaders. */
  layoutToggle?: ReactNode;
}

/**
 * Compact bottom bar that surfaces References and Forged Toolbox as
 * modal CTAs instead of inline blocks. Keeps the events column tall
 * (the user reported that the inline sections were eating vertical
 * space and making timeline events hard to scan).
 *
 * References opens in this bar's own modal. The Forged Toolbox key opens
 * the forge view's toolbox dialog, which returns focus to the key when it
 * closes.
 *
 * The keys stand on one row at every width: on a phone the "Evidence" label
 * gives way to them, and a row still wider than the bar scrolls sideways
 * with its Previous and Next keys. The hint is not a key: it follows the
 * row, on the row's line when there is room and on a line of its own below.
 */
export function SimFooterBar({ citationRegistry, toolRegistry, layoutToggle }: SimFooterBarProps) {
  const [open, setOpen] = useState<null | 'refs'>(null);
  const close = useCallback(() => setOpen(null), []);
  const { openToolbox } = useForgeView();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const refsCount = citationRegistry.list.length;
  const toolsCount = toolRegistry.list.length;

  // Hide the bar entirely only when there's no content AND no layout
  // toggle to host. The toggle is always useful (lets the user switch
  // layouts even before any decisions land), so when SimView passes
  // it in, render the bar.
  if (refsCount === 0 && toolsCount === 0 && !layoutToggle) return null;

  return (
    <>
      <div role="region" aria-label="Simulation evidence" className={styles.bar}>
        <OneRowScroller label="evidence keys" className={styles.keys} rowClassName={styles.keysRow}>
          <span className={styles.label}>Evidence</span>
          {refsCount > 0 && (
            <FooterCta
              label="References"
              count={refsCount}
              onClick={() => setOpen('refs')}
              ariaLabel={`Open References list (${refsCount} sources)`}
            />
          )}
          {toolsCount > 0 && (
            <FooterCta
              label="Forged Toolbox"
              count={toolsCount}
              onClick={(e) => openToolbox(e.currentTarget, 'sim')}
              ariaLabel={`Open Forged Toolbox (${toolsCount} tools)`}
            />
          )}
          {layoutToggle}
        </OneRowScroller>
        <span className={styles.hint}>Click any inline [N] pill to jump to its source.</span>
      </div>

      {open === 'refs' && (
        <Modal
          title={`References · ${refsCount}`}
          onClose={close}
          extraActions={
            <ExportButton
              label="EXPORT JSON"
              filename="paracosm-references.json"
              data={citationRegistry.list.map(e => ({
                n: e.n,
                text: e.text,
                url: e.url,
                doi: e.doi,
                departments: [...e.departments],
                actorNames: [...e.actorNames],
              }))}
            />
          }
        >
          <ReferencesList registry={citationRegistry} />
        </Modal>
      )}
    </>
  );
}

/** One-click JSON download button used inside modal headers. */
function ExportButton({ label, filename, data }: { label: string; filename: string; data: unknown }) {
  return (
    <button
      onClick={() => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      }}
      className={styles.exportBtn}
    >
      {label}
    </button>
  );
}

function FooterCta({ label, count, onClick, ariaLabel }: { label: string; count: number; onClick: (e: MouseEvent<HTMLButtonElement>) => void; ariaLabel: string }) {
  return (
    <button onClick={onClick} aria-label={ariaLabel} className={styles.cta}>
      <span>{label.toUpperCase()}</span>
      <span className={styles.ctaCount}>{count}</span>
    </button>
  );
}

/**
 * Generic centered modal. Backdrop click and Esc both dismiss.
 * `extraActions` slot in the header lets callers add buttons like Export.
 */
function Modal({ title, onClose, children, extraActions }: { title: string; onClose: () => void; children: ReactNode; extraActions?: ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={onClose} className={styles.modalBackdrop}>
      <div onClick={e => e.stopPropagation()} className={styles.modalDialog}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{title}</h2>
          {extraActions}
          <button onClick={onClose} aria-label="Close" className={styles.modalClose}>×</button>
        </div>
        <div className={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}
