import type { ToolRegistry, ToolEntry } from '../../hooks/useToolRegistry';
import { useDashboardNavigation } from '../../App';
import { Tooltip } from './Tooltip';
import styles from './ToolboxSection.module.scss';

interface ToolboxSectionProps {
  registry: ToolRegistry;
  title?: string;
  collapsible?: boolean;
  /** When collapsible, start expanded if true. */
  defaultOpen?: boolean;
  /** Optional toggle callback — used by ReportView to persist state. */
  onToggle?: (open: boolean) => void;
}

/**
 * Numbered list of every tool forged during the simulation. Each entry
 * shows when/where it was first forged, every department that used it,
 * how many times it was reused, and the actual input/output JSON Schema
 * pulled from EmergentToolRegistry on first forge.
 *
 * Rendered at the bottom of SimView (collapsible) and ReportView
 * (always-on). Inline tool cards in EventCard reference these by name.
 */
export function ToolboxSection({ registry, title = 'Forged Toolbox', collapsible = false, defaultOpen = false, onToggle }: ToolboxSectionProps) {
  const navigateTab = useDashboardNavigation();
  if (registry.list.length === 0) return null;

  const jumpToLog = (toolName: string) => {
    // Drop a search-hash the Log tab can read, then navigate. The Log
    // tab filters to forge_attempt / specialist_done entries matching the
    // tool name so users land on the exact event that forged (or
    // reused) this tool instead of scrolling through the whole feed.
    try {
      window.location.hash = `log=${encodeURIComponent(toolName)}`;
    } catch {
      /* silent */
    }
    // Log is a sub-tab of Settings after the merge.
    navigateTab('settings');
  };

  const inner = (
    <ol className={styles.list}>
      {registry.list.map(entry => {
        const depts = [...entry.departments].join(', ');
        const sidesLabel = [...entry.actorNames].join(' · ');
        const inputCount = countSchemaFields(entry.inputSchema, entry.inputFields);
        const outputCount = countSchemaFields(entry.outputSchema, entry.outputFields);
        return (
          <li
            key={entry.n}
            id={`tool-${entry.n}`}
            className={[styles.item, entry.approved ? '' : styles.rejected].filter(Boolean).join(' ')}
          >
            <span className={styles.itemNumber}>[{entry.n}]</span>
            <span>
              <div className={styles.itemHead}>
                <span className={styles.itemName}>{entry.name}</span>
                <span className={entry.approved ? styles.passPill : styles.failPill}>
                  {entry.approved ? `PASS ${entry.confidence.toFixed(2)}` : 'FAIL'}
                </span>
                <span className={styles.itemMode}>{entry.mode}</span>
                <Tooltip
                  content={
                    <div>
                      <div className={styles.tooltipTitle}>Open in sim log</div>
                      <div>
                        Jumps to the Log tab and filters the event stream
                        to <code>{entry.name}</code> — showing every
                        forge_attempt, specialist_done, and reuse event this
                        tool fired in. Useful for tracing the exact
                        moment a tool was created and every downstream
                        department that reused it.
                      </div>
                    </div>
                  }
                >
                  <button
                    type="button"
                    onClick={() => jumpToLog(entry.name)}
                    aria-label={`Open ${entry.name} in simulation log`}
                    className={styles.logBtn}
                  >
                    <span aria-hidden="true">↗</span>
                    log
                  </button>
                </Tooltip>
              </div>
              {entry.description && entry.description !== entry.name && (
                <div className={styles.itemDescription}>{entry.description}</div>
              )}
              <div className={styles.metaRow}>
                <span>first forged T{entry.firstForgedTurn} · {entry.firstForgedDepartment}</span>
                {entry.reuseCount > 0 && <span className={styles.metaReuse}>reused {entry.reuseCount}×</span>}
                {entry.reforgeCount > 0 && (
                  <span className={styles.metaReforge}>
                    {entry.reforgeCount} re-forge{entry.reforgeCount === 1 ? '' : 's'}
                    {entry.rejectedReforges > 0 && (
                      <span className={styles.metaRejected}> ({entry.rejectedReforges} rejected)</span>
                    )}
                  </span>
                )}
                {depts && <span>used by {depts}</span>}
                <span>leader {sidesLabel}</span>
                {inputCount > 0 && <span className={styles.metaInput}>{inputCount} input field{inputCount === 1 ? '' : 's'}</span>}
                {outputCount > 0 && <span className={styles.metaOutput}>{outputCount} output field{outputCount === 1 ? '' : 's'}</span>}
              </div>
              {/* Expandable judge-verdict explanation. Replaces the old
                  hover-popover with inline details that stays open as
                  long as the user wants and is accessible on touch. */}
              <details className={styles.detailsBlock}>
                <summary className={[styles.detailsSummary, entry.approved ? styles.pass : styles.fail].join(' ')}>
                  {entry.approved ? 'WHY IT PASSED' : 'WHY IT FAILED'}
                </summary>
                <div className={styles.verdictBody}>
                  <ForgeVerdictBody entry={entry} />
                </div>
              </details>
              {/* Reuse history (when any). Shows each event this tool
                  was used on, so users can verify the tool paid off
                  across multiple turns instead of getting abandoned. */}
              {entry.history.length > 0 && (
                <details className={styles.detailsBlockTight}>
                  <summary className={[styles.detailsSummary, styles.history].join(' ')}>
                    USE HISTORY · {entry.history.length}
                  </summary>
                  <ol className={styles.historyList}>
                    {entry.history.map((h, i) => {
                      const itemCls = h.rejected
                        ? styles.rejected
                        : h.isReforge ? styles.reforge : '';
                      return (
                        <li key={i} className={[styles.historyItem, itemCls].filter(Boolean).join(' ')}>
                          T{h.turn} · {h.department} · <span className={styles.historyActor}>{h.actorName}</span>
                          {' · '}
                          {i === 0 ? 'first forge' : h.isReforge ? (h.rejected ? 're-forge rejected' : 're-forge accepted') : 'reuse'}
                          {typeof h.confidence === 'number' && ` · conf ${h.confidence.toFixed(2)}`}
                          {h.eventTitle && <span className={styles.historyEventTitle}> · "{h.eventTitle}"</span>}
                        </li>
                      );
                    })}
                  </ol>
                </details>
              )}
              {Boolean(entry.inputSchema || entry.outputSchema) && (
                <details className={styles.detailsBlockTight}>
                  <summary className={[styles.detailsSummary, styles.amber].join(' ')}>SCHEMA</summary>
                  <pre className={styles.codeBlock}>
                    {JSON.stringify({ input: entry.inputSchema ?? null, output: entry.outputSchema ?? null }, null, 2)}
                  </pre>
                </details>
              )}
              {entry.sampleOutput && (
                <details className={styles.detailsBlockTight}>
                  <summary className={[styles.detailsSummary, styles.pass].join(' ')}>LATEST OUTPUT</summary>
                  <pre className={styles.codeBlockShort}>{entry.sampleOutput}</pre>
                </details>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );

  if (collapsible) {
    return (
      <details
        open={defaultOpen}
        onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined}
        className={styles.collapsibleWrap}
      >
        <summary className={styles.collapsibleSummary}>
          {title} · {registry.list.length}
        </summary>
        {inner}
      </details>
    );
  }

  return (
    <div className={styles.collapsibleWrap}>
      <h3 className={styles.title}>{title} · {registry.list.length}</h3>
      {inner}
    </div>
  );
}

/** Just the inner toolbox grid — for embedding inside a modal. */
export function ToolboxList({ registry }: { registry: ToolRegistry }) {
  return <ToolboxSection registry={registry} title="" collapsible={false} />;
}

function countSchemaFields(schema: unknown, fallback: string[]): number {
  if (schema && typeof schema === 'object' && (schema as { properties?: unknown }).properties) {
    return Object.keys((schema as { properties: Record<string, unknown> }).properties).length;
  }
  return fallback.length;
}

/**
 * Inline verdict body for the PASS/FAIL pill on a forged tool. Rendered
 * in an expandable <details> block so the explanation stays open as long
 * as the user needs it — no hover-timeout, no touch awkwardness.
 *
 * PASS body: judge confidence + what the approved tool adds to the run
 * (capability gain, dept-report grounding, reuse economy).
 *
 * FAIL body: judge's verbatim rejection reason + the concrete cost of a
 * failed forge (outcome bonus, morale hit, power cost, lost insight).
 *
 * Exported so EventCard and other forge-card surfaces can reuse the
 * same copy without duplicating the explanation text.
 */
export function ForgeVerdictBody({ entry }: { entry: ToolEntry }) {
  if (entry.approved) {
    return (
      <div className={styles.verdictWrap}>
        <div className={styles.verdictPassHeader}>
          ✓ judge confidence {entry.confidence.toFixed(2)}
        </div>
        <div>
          The LLM judge reviewed this tool's source code, test outputs, and sandbox allowlist,
          and approved it across safety, correctness, determinism, and bounded execution.
        </div>
        <div className={styles.verdictAdds}>
          <b className={styles.verdictAddsLabel}>What this adds to the run:</b>{' '}
          +0.04 outcome bonus for this event · the dept's report cites the tool's computed result ·
          the tool is now reusable by any dept at near-zero cost (+0.02 per reuse).
        </div>
      </div>
    );
  }
  return (
    <div className={styles.verdictWrap}>
      <div className={styles.verdictFailHeader}>✗ judge rejected</div>
      {entry.errorReason ? (
        <div className={styles.verdictRejection}>{entry.errorReason}</div>
      ) : (
        <div className={styles.verdictMissing}>
          (No rejection reason captured. The judge blocked the tool before it could execute.)
        </div>
      )}
      <div className={styles.verdictCost}>
        <b className={styles.verdictCostLabel}>Cost of a failed forge:</b>{' '}
        −0.06 outcome bonus on this event · −0.015 morale per failure (crew confidence eroded) ·
        −1.2&nbsp;kW power (sandbox compute consumed) · no quantitative grounding in the dept's report ·
        the dept retries or moves on without the insight this tool would have provided.
      </div>
    </div>
  );
}

/**
 * Backwards-compatible alias. EventCard still wraps the forge-verdict pill
 * in a hover Tooltip; when those pills migrate to expandable details too
 * this alias can be removed.
 */
export { ForgeVerdictBody as ForgeVerdictTooltip };
