import { useState, useCallback, useEffect, type ReactNode } from 'react';
import type { CitationRegistry } from '../../hooks/useCitationRegistry';
import type { ToolRegistry } from '../../hooks/useToolRegistry';
import { ReferencesList } from '../shared/ReferencesSection';
import { ToolboxSection } from '../shared/ToolboxSection';
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
 */
export function SimFooterBar({ citationRegistry, toolRegistry, layoutToggle }: SimFooterBarProps) {
  const [open, setOpen] = useState<null | 'refs' | 'tools'>(null);
  const close = useCallback(() => setOpen(null), []);

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
            onClick={() => setOpen('tools')}
            ariaLabel={`Open Forged Toolbox (${toolsCount} tools)`}
          />
        )}
        {layoutToggle}
        <span className={styles.spacer} />
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
      {open === 'tools' && (
        <Modal
          title={`Forged Toolbox · ${toolsCount}`}
          onClose={close}
          extraActions={
            <ExportButton
              label="EXPORT JSON"
              filename="paracosm-toolbox.json"
              data={toolRegistry.list.map(e => ({
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
              }))}
            />
          }
        >
          <ToolboxSection registry={toolRegistry} title="" collapsible={false} />
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

function FooterCta({ label, count, onClick, ariaLabel }: { label: string; count: number; onClick: () => void; ariaLabel: string }) {
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
