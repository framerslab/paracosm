import { useEffect, type CSSProperties } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { CostBreakdown, CostSiteBreakdown } from '../../hooks/useGameState';
import { useRetryStats } from '../../hooks/useRetryStats';
import styles from './CostBreakdownModal.module.scss';

/**
 * Modal that breaks down a run's LLM spend by pipeline stage.
 *
 * Shown when the user clicks the COST pill in the StatsBar. Surfaces
 * where the money actually went so a user debugging a high bill can see
 * at a glance whether reactions, departments, or the judge dominated.
 *
 * Each row is a stage: director, commander, departments, judge,
 * reactions, other. Rows are sorted by spend descending so the biggest
 * line item is always at the top. A visual bar graph renders alongside
 * the numbers so the proportion is glanceable.
 */

interface CostBreakdownModalProps {
  combined: CostBreakdown;
  leaderA?: CostBreakdown;
  leaderB?: CostBreakdown;
  leaderAName?: string;
  leaderBName?: string;
  onClose: () => void;
}

/** Human-readable descriptions for each pipeline stage. */
const SITE_DESCRIPTIONS: Record<string, { label: string; description: string }> = {
  director: { label: 'Event Director', description: 'Generates events each turn based on world state' },
  commander: { label: 'Commander', description: 'Reads dept reports, picks options, promotes department heads' },
  departments: { label: 'Department Analysis', description: '5 specialists analyzing each event in parallel' },
  judge: { label: 'Forge Judge', description: 'LLM safety + correctness review of every forged tool' },
  reactions: { label: 'Agent Reactions', description: '~100 colonists reacting to each turn\'s outcome' },
  other: { label: 'Other', description: 'Uncategorized calls' },
};

function fmtUsd(v: number): string {
  if (v < 0.0001) return '$0.0000';
  return `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
}

function fmtTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

/** Threshold-driven color assignment; returns a CSS var token. */
function avgAttemptsColor(avg: number): string {
  if (avg > 1.5) return 'var(--rust)';
  if (avg > 1.1) return 'var(--amber)';
  return 'var(--text-1)';
}

function fallbackColor(rate: number): string {
  if (rate > 0.01) return 'var(--rust)';
  if (rate > 0) return 'var(--amber)';
  return 'var(--text-3)';
}

export function CostBreakdownModal({ combined, leaderA, leaderB, leaderAName, leaderBName, onClose }: CostBreakdownModalProps) {
  // Dismiss on Escape key. Keeps the modal keyboard-accessible without
  // pulling in a dialog library.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  // Fetch /retry-stats when the modal opens. Shows cross-run schema +
  // forge reliability trends from the server's ring buffer.
  const retryStats = useRetryStats(true);

  const breakdown = combined.breakdown ?? {};
  // Sort sites by cost descending. An empty breakdown falls back to an
  // empty array so the modal still renders an informative empty state.
  const rows = Object.entries(breakdown)
    .map(([site, b]) => ({ site, ...b }))
    .sort((a, b) => b.totalCostUSD - a.totalCostUSD);
  const total = combined.totalCostUSD || rows.reduce((s, r) => s + r.totalCostUSD, 0);
  const maxCost = rows[0]?.totalCostUSD ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cost breakdown"
      onClick={onClose}
      className={styles.backdrop}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className={styles.dialog}
      >
        <div className={styles.titleRow}>
          <h3 className={styles.title}>COST BREAKDOWN</h3>
          <button
            onClick={onClose}
            aria-label="Close cost breakdown"
            className={styles.escBtn}
          >
            ESC
          </button>
        </div>
        <div className={styles.totalLine}>
          Total: <span className={styles.totalAmount}>{fmtUsd(total)}</span>
          {' · '}
          {combined.llmCalls.toLocaleString()} calls
          {' · '}
          {fmtTokens(combined.totalTokens)} tokens
        </div>

        {/* Prompt-cache savings block. Only renders when the provider
            reported cache activity (Anthropic on Sonnet/Haiku). OpenAI's
            automatic caching is not exposed per-call so this stays
            hidden for OpenAI runs. Consumer-facing framing:
              - headline: concrete dollars saved
              - sub: hit rate as percentage of input tokens
              - details: reads / creates in raw tokens for the curious */}
        {(combined.cacheReadTokens || combined.cacheCreationTokens) ? (() => {
          const reads = combined.cacheReadTokens ?? 0;
          const creates = combined.cacheCreationTokens ?? 0;
          const savings = combined.cacheSavingsUSD ?? 0;
          // Hit rate = reads as a share of (reads + creates). 100% means
          // every cache-tagged token on this run was served from an
          // existing cache entry (turn 2+ on a stable prefix). 0% means
          // nothing was reused — the cache filled but didn't pay off.
          const total = reads + creates;
          const hitRate = total > 0 ? reads / total : 0;

          let verdictColor = 'var(--text-3)';
          let verdictLine: string;
          if (savings > 0.001) {
            verdictColor = 'var(--green)';
            verdictLine = `Saved ${fmtUsd(savings)} via prompt caching`;
          } else if (savings < -0.001) {
            verdictColor = 'var(--amber)';
            // Negative savings means creation overhead hasn't been
            // amortized yet. Normal on turn 1; concerning by turn 3+.
            verdictLine = `Cache priming cost ${fmtUsd(-savings)} so far · reuse will repay this`;
          } else if (reads > 0) {
            verdictColor = 'var(--green)';
            verdictLine = 'Cache reuse breaking even with priming cost';
          } else {
            verdictColor = 'var(--amber)';
            verdictLine = 'Cache filled but nothing reused yet · retry run or check prompt stability';
          }

          return (
            <div className={styles.cacheBlock}>
              <div className={styles.cacheLabel}>PROMPT CACHING</div>
              <div
                className={styles.cacheVerdict}
                style={{ '--cache-verdict-color': verdictColor } as CSSProperties}
              >
                {verdictLine}
              </div>
              <div className={styles.cacheSubLine}>
                {Math.round(hitRate * 100)}% hit rate on cached input ({fmtTokens(reads)} reused / {fmtTokens(total)} cache tokens)
              </div>
              <div className={styles.cacheTokenRow}>
                <span>reads {fmtTokens(reads)} <span className={styles.cacheMultiplier}>@0.10×</span></span>
                <span>creates {fmtTokens(creates)} <span className={styles.cacheMultiplier}>@1.25×</span></span>
              </div>
            </div>
          );
        })() : null}

        {rows.length === 0 ? (
          <div className={styles.emptyState}>
            No LLM calls have been billed yet. Start a simulation to see spend by pipeline stage.
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr className={styles.headRow}>
                <th className={styles.th}>STAGE</th>
                <th className={styles.thRight}>CALLS</th>
                <th className={styles.thRight}>TOKENS</th>
                <th className={styles.thRight}>COST</th>
                <th className={styles.thRight}>%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const info = SITE_DESCRIPTIONS[r.site] ?? { label: r.site, description: '' };
                const pct = total > 0 ? (r.totalCostUSD / total) * 100 : 0;
                const barPct = maxCost > 0 ? (r.totalCostUSD / maxCost) * 100 : 0;
                return (
                  <tr key={r.site} className={styles.bodyRow}>
                    <td className={styles.stageCell}>
                      <div className={styles.stageLabel}>{info.label}</div>
                      <div className={styles.stageDescription}>{info.description}</div>
                      {/* Proportional bar. Width maps to % of the largest
                          stage so you can eyeball relative scale at a glance. */}
                      <div aria-hidden="true" className={styles.bar}>
                        <div
                          className={styles.barFill}
                          style={{ '--bar-pct': `${barPct}%` } as CSSProperties}
                        />
                      </div>
                    </td>
                    <td className={styles.numericCell}>{r.calls.toLocaleString()}</td>
                    <td className={styles.numericCell}>{fmtTokens(r.totalTokens)}</td>
                    <td className={styles.numericCellGreen}>{fmtUsd(r.totalCostUSD)}</td>
                    <td className={styles.numericCellMuted}>{pct.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Schema retry rollup. Each row is one Zod schema that the
            validation wrappers hit at least once during the run. Attempts
            per call > 1.0 means the model is fighting the output format
            on that schema; fallbacks > 0 means the retry loop exhausted
            and the turn ran with an empty skeleton. */}
        {combined.schemaRetries && Object.keys(combined.schemaRetries).length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionLabel}>SCHEMA RELIABILITY</div>
            <table className={styles.tableSm}>
              <thead>
                <tr className={styles.headRow}>
                  <th className={styles.th}>SCHEMA</th>
                  <th className={styles.thRight}>CALLS</th>
                  <th className={styles.thRight}>AVG ATTEMPTS</th>
                  <th className={styles.thRight}>FALLBACKS</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(combined.schemaRetries)
                  .sort((a, b) => b[1].calls - a[1].calls)
                  .map(([schemaName, bucket]) => {
                    const avg = bucket.calls > 0 ? bucket.attempts / bucket.calls : 0;
                    const avgColor = avgAttemptsColor(avg);
                    const fbColor = bucket.fallbacks > 0 ? 'var(--rust)' : 'var(--text-3)';
                    return (
                      <tr key={schemaName} className={styles.bodyRow}>
                        <td className={styles.cellSchemaName}>{schemaName}</td>
                        <td className={styles.cellNumericTight}>{bucket.calls}</td>
                        <td
                          className={styles.cellAvgAttempts}
                          style={{ '--avg-color': avgColor } as CSSProperties}
                        >
                          {avg.toFixed(2)}
                        </td>
                        <td
                          className={styles.cellFallback}
                          style={{
                            '--fb-color': fbColor,
                            '--fb-weight': bucket.fallbacks > 0 ? '700' : '400',
                          } as CSSProperties}
                        >
                          {bucket.fallbacks}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div className={styles.sectionFootnote}>
              1.00 = first-try success. Higher = model retrying on validation failures. Tune <code className="mono">maxRetries</code> or tighten schema if a row stays above 1.3.
            </div>
          </div>
        )}

        {/* Forge reliability for the current run. Approval rate below
            ~60% usually means the judge is rejecting legitimately (model
            forging broken tools) OR the judge rubric has drifted too
            strict. avgConfidence below 0.7 means approved tools are
            marginal quality. */}
        {combined.forgeStats && combined.forgeStats.attempts > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionLabel}>FORGE RELIABILITY</div>
            {(() => {
              const f = combined.forgeStats!;
              const approvalRate = f.attempts > 0 ? f.approved / f.attempts : 0;
              const avgConf = f.approved > 0 ? f.approvedConfidenceSum / f.approved : 0;
              const rateColor = approvalRate < 0.5 ? 'var(--rust)' : approvalRate < 0.75 ? 'var(--amber)' : 'var(--green)';
              const confColor = avgConf > 0 && avgConf < 0.6 ? 'var(--amber)' : 'var(--text-1)';
              return (
                <table className={styles.tableSm}>
                  <thead>
                    <tr className={styles.headRow}>
                      <th className={styles.thRight}>ATTEMPTS</th>
                      <th className={styles.thRight}>APPROVED</th>
                      <th className={styles.thRight}>REJECTED</th>
                      <th className={styles.thRight}>APPROVAL RATE</th>
                      <th className={styles.thRight}>AVG CONF</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={styles.bodyRow}>
                      <td className={styles.cellRight1}>{f.attempts}</td>
                      <td className={styles.cellRightGreen}>{f.approved}</td>
                      <td className={f.rejected > 0 ? styles.cellRightRust : styles.cellRightMuted}>{f.rejected}</td>
                      <td
                        className={styles.cellRateColor}
                        style={{ '--rate-color': rateColor } as CSSProperties}
                      >
                        {(approvalRate * 100).toFixed(0)}%
                      </td>
                      <td
                        className={styles.cellConfColor}
                        style={{ '--conf-color': confColor } as CSSProperties}
                      >
                        {avgConf > 0 ? avgConf.toFixed(2) : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              );
            })()}
            <div className={styles.sectionFootnote}>
              Rejections come from shape check OR judge verdict. Retry-with-feedback usually recovers; persistent low approval rate suggests the department model is weak at writing schema-compliant code.
            </div>
          </div>
        )}

        {/* Cross-run trend from /retry-stats. Populated once on modal
            open. Separates compile:* schemas (compiler hook generation)
            from runtime schemas so operators can see each class's
            health distinctly. */}
        {(() => {
          const rs = retryStats.data;
          if (retryStats.loading && !rs) {
            return <div className={styles.statusInline}>RECENT RUNS — loading…</div>;
          }
          if (retryStats.error) {
            return (
              <div className={styles.statusInline}>
                RECENT RUNS — <span className={styles.statusErrorTag}>fetch failed ({retryStats.error})</span>
              </div>
            );
          }
          if (!rs || rs.runCount === 0) return null;

          const runtimeSchemas = Object.entries(rs.schemas).filter(([k]) => !k.startsWith('compile:'));
          const compileSchemas = Object.entries(rs.schemas)
            .filter(([k]) => k.startsWith('compile:'))
            .map(([k, v]) => [k.replace(/^compile:/, ''), v] as const);
          const forges = rs.forges;
          const caches = rs.caches;
          const providerErrors = rs.providerErrors;

          const schemaRow = ([name, b]: readonly [string, typeof rs.schemas[string]]) => {
            const avgColor = avgAttemptsColor(b.avgAttempts);
            const fbColor = fallbackColor(b.fallbackRate);
            return (
              <tr key={name} className={styles.bodyRow}>
                <td className={styles.cellSchemaName}>{name}</td>
                <td className={styles.cellNumericTight}>{b.calls}</td>
                <td
                  className={styles.cellAvgAttempts}
                  style={{ '--avg-color': avgColor } as CSSProperties}
                >
                  {b.avgAttempts.toFixed(2)}
                </td>
                <td
                  className={styles.cellFallback}
                  style={{
                    '--fb-color': fbColor,
                    '--fb-weight': b.fallbacks > 0 ? '700' : '400',
                  } as CSSProperties}
                >
                  {(b.fallbackRate * 100).toFixed(2)}%
                </td>
              </tr>
            );
          };

          return (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>RECENT RUNS (last {rs.runCount})</div>

              {runtimeSchemas.length > 0 && (
                <div className={styles.subBlock}>
                  <div className={styles.subBlockLabel}>RUNTIME SCHEMAS</div>
                  <table className={styles.tableSm}>
                    <thead>
                      <tr className={styles.headRow}>
                        <th className={styles.th}>SCHEMA</th>
                        <th className={styles.thRight}>CALLS</th>
                        <th className={styles.thRight}>AVG ATT</th>
                        <th className={styles.thRight}>FALLBACK %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runtimeSchemas.sort((a, b) => b[1].calls - a[1].calls).map(schemaRow)}
                    </tbody>
                  </table>
                </div>
              )}

              {compileSchemas.length > 0 && (
                <div className={styles.subBlock}>
                  <div className={styles.subBlockLabel}>COMPILE HOOKS</div>
                  <table className={styles.tableSm}>
                    <thead>
                      <tr className={styles.headRow}>
                        <th className={styles.th}>HOOK</th>
                        <th className={styles.thRight}>CALLS</th>
                        <th className={styles.thRight}>AVG ATT</th>
                        <th className={styles.thRight}>FALLBACK %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compileSchemas.sort((a, b) => b[1].calls - a[1].calls).map(schemaRow)}
                    </tbody>
                  </table>
                </div>
              )}

              {forges && forges.runsPresent > 0 && (
                <div className={styles.subBlock}>
                  <div className={styles.subBlockLabel}>FORGES</div>
                  <table className={styles.tableSm}>
                    <thead>
                      <tr className={styles.headRow}>
                        <th className={styles.thRight}>RUNS</th>
                        <th className={styles.thRight}>ATTEMPTS</th>
                        <th className={styles.thRight}>ATTEMPT RATE</th>
                        <th className={styles.thRight}>UNIQUE TOOLS</th>
                        <th className={styles.thRight}>EVENTUALLY APPROVED</th>
                        <th className={styles.thRight}>TERMINAL FAILS</th>
                        <th className={styles.thRight}>AVG CONF</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className={styles.bodyRow}>
                        <td className={styles.cellRight1}>{forges.runsPresent}</td>
                        <td className={styles.cellRight1}>{forges.totalAttempts}</td>
                        <td
                          className={styles.cellRateColor}
                          style={{
                            '--rate-color': forges.approvalRate < 0.5
                              ? 'var(--rust)'
                              : forges.approvalRate < 0.75 ? 'var(--amber)' : 'var(--green)',
                          } as CSSProperties}
                        >
                          {(forges.approvalRate * 100).toFixed(1)}%
                        </td>
                        <td className={styles.cellRight1}>{forges.totalUniqueNames}</td>
                        <td
                          className={styles.cellRateColor}
                          style={{
                            '--rate-color': forges.uniqueApprovalRate < 0.8
                              ? 'var(--rust)'
                              : forges.uniqueApprovalRate < 0.95 ? 'var(--amber)' : 'var(--green)',
                          } as CSSProperties}
                        >
                          {forges.totalUniqueApproved} ({(forges.uniqueApprovalRate * 100).toFixed(0)}%)
                        </td>
                        <td
                          className={styles.cellFallback}
                          style={{
                            '--fb-color': forges.totalUniqueTerminalRejections > 0 ? 'var(--rust)' : 'var(--text-3)',
                            '--fb-weight': forges.totalUniqueTerminalRejections > 0 ? '700' : '400',
                          } as CSSProperties}
                        >
                          {forges.totalUniqueTerminalRejections}
                        </td>
                        <td className={styles.cellRight1} style={{ fontWeight: 700 }}>
                          {forges.avgApprovedConfidence > 0 ? forges.avgApprovedConfidence.toFixed(2) : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div className={styles.sectionFootnoteTight}>
                    ATTEMPT RATE counts every forge call including retries. EVENTUALLY APPROVED is the real quality signal — tools that landed in the toolbox. TERMINAL FAILS are tools the retry loop never recovered.
                  </div>
                  {(() => {
                    const rr = forges.rejectionReasons;
                    const totalCategorized = rr.schema_extra_field + rr.shape_check + rr.parse_error + rr.judge_correctness + rr.other;
                    if (totalCategorized === 0) return null;
                    const pct = (n: number) => totalCategorized > 0 ? Math.round((n / totalCategorized) * 100) : 0;
                    const cellStyle = (n: number, warnColor: string): CSSProperties => ({
                      '--rj-color': n > 0 ? warnColor : 'var(--text-3)',
                      '--rj-weight': n > 0 ? '700' : '400',
                    } as CSSProperties);
                    return (
                      <div className={styles.rejectionWrap}>
                        <div className={styles.rejectionLabel}>
                          REJECTION REASONS (last {forges.runsPresent} run{forges.runsPresent === 1 ? '' : 's'})
                        </div>
                        <table className={styles.tableSm}>
                          <thead>
                            <tr className={styles.headRow}>
                              <th className={styles.thRight}>SCHEMA EXTRA FIELD</th>
                              <th className={styles.thRight}>SHAPE CHECK</th>
                              <th className={styles.thRight}>PARSE ERROR</th>
                              <th className={styles.thRight}>JUDGE CORRECTNESS</th>
                              <th className={styles.thRight}>OTHER</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className={styles.bodyRow}>
                              <td className={styles.rejectionCell} style={cellStyle(rr.schema_extra_field, 'var(--amber)')}>
                                {rr.schema_extra_field} ({pct(rr.schema_extra_field)}%)
                              </td>
                              <td className={styles.rejectionCell} style={cellStyle(rr.shape_check, 'var(--amber)')}>
                                {rr.shape_check} ({pct(rr.shape_check)}%)
                              </td>
                              <td className={styles.rejectionCell} style={cellStyle(rr.parse_error, 'var(--rust)')}>
                                {rr.parse_error} ({pct(rr.parse_error)}%)
                              </td>
                              <td className={styles.rejectionCell} style={cellStyle(rr.judge_correctness, 'var(--rust)')}>
                                {rr.judge_correctness} ({pct(rr.judge_correctness)}%)
                              </td>
                              <td className={styles.cellRightMuted}>
                                {rr.other} ({pct(rr.other)}%)
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        <div className={styles.sectionFootnoteTight}>
                          SCHEMA EXTRA FIELD dominating means the LLM's return-keys don't match its declared outputSchema.properties — the target of the 2026-04-18 forge-guidance prompt fix. JUDGE CORRECTNESS = real logic bugs the judge caught.
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {providerErrors && providerErrors.runsPresent > 0 && (
                <div className={styles.subBlock}>
                  <div className={styles.subBlockLabel}>PROVIDER ERRORS</div>
                  <table className={styles.tableSm}>
                    <thead>
                      <tr className={styles.headRow}>
                        <th className={styles.thRight}>RUNS W/ ERRORS</th>
                        <th className={styles.thRight}>TOTAL</th>
                        <th className={styles.thRight}>AUTH</th>
                        <th className={styles.thRight}>QUOTA</th>
                        <th className={styles.thRight}>RATE</th>
                        <th className={styles.thRight}>NET</th>
                        <th className={styles.thRight}>OTHER</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className={styles.bodyRow}>
                        <td className={styles.cellRight1}>{providerErrors.runsPresent}</td>
                        <td className={styles.cellRight1} style={{ fontWeight: 700 }}>{providerErrors.total}</td>
                        <td
                          className={styles.cellFallback}
                          style={{
                            '--fb-color': providerErrors.auth > 0 ? 'var(--rust)' : 'var(--text-3)',
                            '--fb-weight': providerErrors.auth > 0 ? '700' : '400',
                          } as CSSProperties}
                        >
                          {providerErrors.auth}
                        </td>
                        <td
                          className={styles.cellFallback}
                          style={{
                            '--fb-color': providerErrors.quota > 0 ? 'var(--rust)' : 'var(--text-3)',
                            '--fb-weight': providerErrors.quota > 0 ? '700' : '400',
                          } as CSSProperties}
                        >
                          {providerErrors.quota}
                        </td>
                        <td className={providerErrors.rate_limit > 0 ? styles.cellFallback : styles.cellRightMuted}
                          style={providerErrors.rate_limit > 0 ? { '--fb-color': 'var(--amber)', '--fb-weight': '400' } as CSSProperties : undefined}
                        >
                          {providerErrors.rate_limit}
                        </td>
                        <td className={providerErrors.network > 0 ? styles.cellFallback : styles.cellRightMuted}
                          style={providerErrors.network > 0 ? { '--fb-color': 'var(--amber)', '--fb-weight': '400' } as CSSProperties : undefined}
                        >
                          {providerErrors.network}
                        </td>
                        <td className={providerErrors.unknown > 0 ? styles.cellFallback : styles.cellRightMuted}
                          style={providerErrors.unknown > 0 ? { '--fb-color': 'var(--amber)', '--fb-weight': '400' } as CSSProperties : undefined}
                        >
                          {providerErrors.unknown}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div className={styles.sectionFootnoteTight}>
                    AUTH/QUOTA are terminal (run aborts). RATE/NET/OTHER are non-terminal — the retry layer handles them.
                  </div>
                </div>
              )}

              {caches && caches.runsPresent > 0 && (
                <div>
                  <div className={styles.subBlockLabel}>PROMPT CACHE</div>
                  <table className={styles.tableSm}>
                    <thead>
                      <tr className={styles.headRow}>
                        <th className={styles.thRight}>RUNS WITH CACHE</th>
                        <th className={styles.thRight}>READ TOKENS</th>
                        <th className={styles.thRight}>CREATE TOKENS</th>
                        <th className={styles.thRight}>READ RATIO</th>
                        <th className={styles.thRight}>SAVINGS</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className={styles.bodyRow}>
                        <td className={styles.cellRight1}>{caches.runsPresent}</td>
                        <td className={styles.cellRight1}>{fmtTokens(caches.totalReadTokens)}</td>
                        <td className={styles.cellNumericTight}>{fmtTokens(caches.totalCreationTokens)}</td>
                        <td
                          className={styles.cellRateColor}
                          style={{
                            '--rate-color': caches.readRatio >= 0.7
                              ? 'var(--green)'
                              : caches.readRatio >= 0.4 ? 'var(--amber)' : 'var(--rust)',
                          } as CSSProperties}
                        >
                          {(caches.readRatio * 100).toFixed(0)}%
                        </td>
                        <td
                          className={styles.cellRateColor}
                          style={{
                            '--rate-color': caches.totalSavingsUSD > 0 ? 'var(--green)' : 'var(--text-2)',
                          } as CSSProperties}
                        >
                          {fmtUsd(caches.totalSavingsUSD)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div className={styles.sectionFootnoteTight}>
                    Read ratio &gt;= 70% is healthy. Lower ratios mean the cache keeps getting invalidated.
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Per-leader totals when both sides have reported. Lets the user
            see if one leader's simulation is unusually expensive (e.g.
            runaway tool-call loop on one side). */}
        {leaderA && leaderB && (leaderA.totalCostUSD > 0 || leaderB.totalCostUSD > 0) && (
          <div className={styles.section}>
            <div className={styles.sectionLabel}>PER LEADER</div>
            <div className={styles.perLeaderRow}>
              <div className={styles.leaderCard}>
                <div
                  className={styles.leaderName}
                  style={{ '--leader-color': 'var(--vis)' } as CSSProperties}
                >
                  {leaderAName || 'Leader A'}
                </div>
                <div className={styles.leaderCost}>{fmtUsd(leaderA.totalCostUSD)}</div>
                <div className={styles.leaderMeta}>{leaderA.llmCalls} calls · {fmtTokens(leaderA.totalTokens)} tok</div>
              </div>
              <div className={styles.leaderCard}>
                <div
                  className={styles.leaderName}
                  style={{ '--leader-color': 'var(--eng)' } as CSSProperties}
                >
                  {leaderBName || 'Leader B'}
                </div>
                <div className={styles.leaderCost}>{fmtUsd(leaderB.totalCostUSD)}</div>
                <div className={styles.leaderMeta}>{leaderB.llmCalls} calls · {fmtTokens(leaderB.totalTokens)} tok</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Re-export the type so consumers can import from a single place.
export type { CostSiteBreakdown };
