import * as React from 'react';
import { useEffect, useState, type CSSProperties } from 'react';
import type { ProcessedEvent } from '../../hooks/useGameState';
import { getActorColorVar } from '../../hooks/useGameState';
import { useScenarioContext } from '../../App';
import { useToolContext } from '../../hooks/useToolRegistry';
import { Badge } from '../shared/Badge';
import { Tooltip } from '../shared/Tooltip';
import { CitationPills } from '../shared/CitationPills';
import styles from './EventCard.module.scss';

// `import * as React` keeps the SSR test runner happy. The dashboard's
// tsconfig sets `jsx: 'react-jsx'` so React is not directly referenced
// in compiled JSX, but `node --import tsx` falls through a different
// JSX transform path during the unit-test run that still expects
// `React` to be in scope.
void React;

interface EventCardProps {
  event: ProcessedEvent;
  actorIndex: number;
}

const moodColors: Record<string, string> = {
  positive: 'var(--green)', negative: 'var(--rust)', anxious: 'var(--amber)',
  defiant: 'var(--rust)', hopeful: 'var(--green)', resigned: 'var(--text-3)', neutral: 'var(--text-2)',
};

const moodBgColors: Record<string, string> = {
  positive: '#6aad48', negative: '#e06530', anxious: '#e8b44a',
  defiant: '#e06530', hopeful: '#6aad48', resigned: '#a89878', neutral: '#a89878',
};

export function EventCard({ event, actorIndex }: EventCardProps) {
  const scenario = useScenarioContext();
  const toolRegistry = useToolContext();
  // Open detail modal for a forge_attempt or specialist_done tool card. Tracks
  // the inspected tool's name so the modal can pull schema + sample
  // output + reuse stats from the registry.
  const [inspectingTool, setInspectingTool] = useState<string | null>(null);
  const sideColor = getActorColorVar(actorIndex);
  const sideStyle = { '--side-color': sideColor } as CSSProperties;
  const dd = event.data;

  switch (event.type) {
    case 'turn_start':
      return null;

    case 'event_start': {
      const idx = Number(dd.eventIndex ?? 0);
      const total = Number(dd.totalEvents ?? 1);
      const title = String(dd.title || '');
      const category = String(dd.category || '');
      if (total <= 1) return null;
      return (
        <div className={[styles.eventStartRow, idx > 0 ? styles.notFirst : ''].filter(Boolean).join(' ')}>
          <span className={styles.eventNumber}>EVENT {idx + 1}/{total}</span>
          <span className={styles.eventStartTitle}>{title}</span>
          {category && <span className={styles.eventCategoryPill}>{category}</span>}
        </div>
      );
    }

    case 'promotion': {
      const reason = String(dd.reason || '');
      const name = String(dd.name || '');
      const role = String(dd.role || '');
      return (
        <Tooltip content={
          <div>
            <b className={styles.promotionTooltipTitle} style={sideStyle}>Promotion: {role}</b>
            {name && (
              <div className={styles.promotionTooltipRow}>
                <span className={styles.promotionTooltipKey}>Agent:</span>{' '}
                <span className={styles.promotionTooltipValue}>{name}</span>
              </div>
            )}
            {reason && <div className={styles.promotionTooltipReason}>{reason}</div>}
          </div>
        }>
          <div className={styles.promotionRow}>
            <span className={styles.promotionArrow}>&rarr;</span>
            <span className={styles.promotionRole} style={sideStyle}>{role}</span>
            <span className={styles.promotionReason}>{reason}</span>
          </div>
        </Tooltip>
      );
    }

    case 'specialist_start':
    case 'decision_pending':
      return null;

    case 'forge_attempt': {
      // Real-time forge notification. Renders as a slim inline card
      // between dept reports so the user can SEE emergent capabilities
      // appear as they're invented, not buried in a summary later.
      const dept = String(dd.department || '');
      const name = String(dd.name || 'unnamed');
      const description = String(dd.description || name);
      const mode = String(dd.mode || 'sandbox');
      const approved = dd.approved !== false;
      const confidence = typeof dd.confidence === 'number' ? dd.confidence : 0.85;
      const errorReason = dd.errorReason ? String(dd.errorReason) : '';
      // Approved forge cards pick up the leader-side color (amber for A,
      // teal for B) so the stream makes it obvious at a glance which
      // column's forge just happened. Failed forges always stay rust —
      // failure is a semantic signal, not a leader attribution.
      const accent = approved ? sideColor : 'var(--rust)';
      const inputFields = Array.isArray(dd.inputFields) ? (dd.inputFields as string[]) : [];
      const outputFields = Array.isArray(dd.outputFields) ? (dd.outputFields as string[]) : [];

      const forgeStyle = {
        '--accent': accent,
        '--bg-tint': approved
          ? `color-mix(in srgb, ${sideColor} 7%, transparent)`
          : 'rgba(224,101,48,0.04)',
        '--border-tint': approved
          ? `color-mix(in srgb, ${sideColor} 25%, transparent)`
          : 'rgba(224,101,48,0.2)',
        '--shadow-tint': approved
          ? `0 0 0 1px color-mix(in srgb, ${sideColor} 10%, transparent)`
          : 'var(--card-shadow)',
        '--badge-color': approved ? 'var(--bg-deep)' : '#fff',
        '--badge-bg': accent,
        '--badge-shadow': approved ? '0 0 8px rgba(232,180,74,0.4)' : 'none',
      } as CSSProperties;

      return (
        <>
        <details className={styles.forgeDetails} style={forgeStyle}>
          <summary className={styles.forgeSummary}>
            <span className={styles.forgeRow}>
              {/* Approved forges read as success ("✦ FORGED TOOL").
                  Rejected forges are routine — judge runs schema + safety
                  + correctness checks and rejecting an attempt just
                  means the agent will re-forge with adjustments. The
                  prior "✗" prefix and the bare "FAIL" pill made these
                  read as system errors to first-time viewers; they're
                  now framed as "RETRYING" so the SIM panel doesn't
                  look like the run is broken. */}
              <span className={styles.forgeBadge}>
                {approved ? '✦ FORGED TOOL' : '↻ FORGE RETRY'}
              </span>
              <span className={styles.forgeDept}>{dept}</span>
              <span className={styles.forgeDescription}>{description}</span>
              <span className={styles.forgeName}>{name} ({mode})</span>
              <span className={approved ? styles.forgeVerdictPass : styles.forgeVerdictFail}>
                {approved ? `PASS ${confidence.toFixed(2)}` : 'RETRY'}
              </span>
            </span>
          </summary>
          {/* INSPECT lives OUTSIDE <summary> so axe + screen readers
              don't flag a nested-interactive (summary is itself
              interactive). Position is absolute, mirroring the
              tool-card pattern at .toolInspectBtn — visually sits
              on the summary row's right edge while staying a sibling
              of <summary> in the DOM. */}
          <button
            type="button"
            onClick={() => setInspectingTool(name)}
            aria-label={`Inspect forged tool ${name}`}
            className={styles.forgeInspectAbs}
          >
            INSPECT
          </button>
          <div className={styles.forgeBody}>
            {(inputFields.length > 0 || outputFields.length > 0) && (
              <div className={styles.forgeFieldsRow}>
                {inputFields.length > 0 && (
                  <span><span className={styles.fieldsLabelIn}>in:</span> {inputFields.join(', ')}</span>
                )}
                {outputFields.length > 0 && (
                  <span><span className={styles.fieldsLabelOut}>out:</span> {outputFields.join(', ')}</span>
                )}
              </div>
            )}
            {!approved && errorReason && (
              <div className={styles.forgeError}>{errorReason}</div>
            )}
          </div>
        </details>
        {inspectingTool && (
          <ToolDetailModal
            entry={toolRegistry.getEntry(inspectingTool)}
            fallbackName={inspectingTool}
            onClose={() => setInspectingTool(null)}
          />
        )}
        </>
      );
    }

    case 'specialist_done': {
      const dept = String(dd.department || '');
      // Dedupe: newly-forged tools this turn already appeared as live
      // `forge_attempt` cards above in the sim log — rendering them
      // again in the dept summary produces stylistically-inconsistent
      // duplicate cards for the same forge. `allTools` keeps the total
      // count (new + reused) for the "+N tools" badge so the dept
      // header still reflects full activity; `tools` filters to only
      // reused entries which show cross-dept reuse + first-forge
      // back-reference that forge_attempt cards don't.
      const allTools = (dd._filteredTools as Array<Record<string, unknown>>) || [];
      const tools = allTools.filter(t => t?.isNew !== true);
      const risks = Array.isArray(dd.risks) ? dd.risks : [];
      const recs = Array.isArray(dd.recommendedActions) ? dd.recommendedActions.map(String) : [];
      const severity = risks.some((r: any) => r.severity === 'critical') ? 'critical' : risks.some((r: any) => r.severity === 'high') ? 'high' : '';

      const summary = String(dd.summary || '');
      const citeCount = Number(dd.citations) || 0;

      // Don't render empty department cards with no content. Use
      // allTools here so we don't drop the dept card entirely when a
      // dept only forged new tools (those still count as real work;
      // they're just rendered above as forge_attempt cards).
      if (!summary && risks.length === 0 && recs.length === 0 && allTools.length === 0 && citeCount === 0) {
        return null;
      }

      const cardStyle = {
        '--card-bg': severity === 'critical'
          ? 'rgba(224,101,48,.08)'
          : severity === 'high' ? 'rgba(232,180,74,.06)' : 'var(--bg-card)',
        '--card-border': severity === 'critical'
          ? 'rgba(224,101,48,.25)'
          : severity === 'high' ? 'rgba(232,180,74,.2)' : 'var(--border)',
        '--card-accent': severity === 'critical'
          ? 'var(--rust)'
          : severity === 'high' ? 'var(--amber)' : 'var(--teal)',
      } as CSSProperties;

      const sevStyle = severity ? ({
        '--sev-color': severity === 'critical' ? 'var(--rust)' : 'var(--amber)',
        '--sev-bg': severity === 'critical' ? 'rgba(224,101,48,.15)' : 'rgba(232,180,74,.1)',
      } as CSSProperties) : undefined;

      return (
        <>
        <div className={styles.specWrap}>
          <details className={styles.specDetails} style={cardStyle}>
            <summary className={styles.specSummaryRow}>
              <span className={styles.specHeaderDept}>
                {scenario.ui.departmentIcons[dept] || ''} {dept}
              </span>
              {allTools.length > 0 && (
                <span className={styles.specToolCount}>
                  +{allTools.length} tool{allTools.length === 1 ? '' : 's'}
                  {tools.length < allTools.length && ` (${tools.length} reused)`}
                </span>
              )}
              {severity && (
                <span className={styles.severityBadge} style={sevStyle}>
                  {severity.toUpperCase()} RISK
                </span>
              )}
              <CitationPills
                citations={(dd.citationList as Array<Record<string, string>>) || []}
                inline
                label=""
              />
            </summary>
            <div className={styles.specBody}>
              {summary ? (
                <div className={styles.specSummary}>{summary}</div>
              ) : (risks.length === 0 && recs.length === 0) && (citeCount > 0 || allTools.length > 0) ? (
                <div className={styles.specSummaryEmpty}>
                  Department analysis complete &mdash; no narrative summary returned, but
                  {citeCount > 0 && ` ${citeCount} source${citeCount === 1 ? '' : 's'} surveyed`}
                  {citeCount > 0 && allTools.length > 0 && ' and '}
                  {allTools.length > 0 && ` ${allTools.length} tool${allTools.length === 1 ? '' : 's'} forged`}
                  .
                </div>
              ) : null}

              {risks.length > 0 && (
                <div className={styles.specRisks}>
                  <div className={styles.specRisksLabel}>RISKS</div>
                  {risks.slice(0, 3).map((r: any, i: number) => (
                    <div key={i} className={styles.specRiskRow}>
                      <span
                        className={styles.specRiskSeverity}
                        style={{
                          '--risk-color': (r.severity === 'critical' || r.severity === 'high') ? 'var(--rust)' : 'var(--amber)',
                        } as CSSProperties}
                      >
                        {String(r.severity || 'med').toUpperCase()}
                      </span>
                      <span>{String(r.description || '')}</span>
                    </div>
                  ))}
                </div>
              )}

              {recs.length > 0 && (
                <div className={styles.specRecs}>
                  <div className={styles.specRecsLabel}>RECOMMENDATIONS</div>
                  {recs.slice(0, 3).map((rec, i) => (
                    <div key={i} className={styles.specRecRow}>{rec}</div>
                  ))}
                </div>
              )}
            </div>
          </details>

          {/* Tool cards. First-forge gets a bright amber pulse +
              "FORGED TOOL" badge to make emergent capabilities obvious;
              reused calls stay subtle and green with a back-reference
              to the first-forge turn. "FORGED TOOL" matches the header's
              `+N tool` count language so the two labels read as the
              same concept instead of two near-synonyms ("forged" vs
              "newly forged") describing the same action. Schema and
              raw output are revealed on expand. */}
          {tools.map((t: any, i: number) => {
            const approved = t.approved !== false;
            const isNew = t.isNew === true;
            // Color treatment: newly-forged tool uses the leader-side
            // color (amber for A, teal for B) so a quick visual scan of
            // the sim flow shows which column invented the capability.
            // Reused calls stay green (stable, same across leaders).
            // Failed forges stay rust (semantic failure signal).
            const accent = !approved ? 'var(--rust)' : isNew ? sideColor : 'var(--green)';
            const bgTint = !approved
              ? 'rgba(224,101,48,.04)'
              : isNew ? `color-mix(in srgb, ${sideColor} 10%, transparent)` : 'rgba(106,173,72,.06)';
            const borderTint = !approved
              ? 'rgba(224,101,48,.15)'
              : isNew ? `color-mix(in srgb, ${sideColor} 40%, transparent)` : 'rgba(106,173,72,.2)';
            const shadow = isNew
              ? `0 0 0 1px color-mix(in srgb, ${sideColor} 15%, transparent), var(--card-shadow)`
              : 'var(--card-shadow)';
            const inputSchema = t.inputSchema;
            const outputSchema = t.outputSchema;
            const hasFullSchema = !!inputSchema || !!outputSchema;
            const detailStyle = {
              '--tool-bg': bgTint,
              '--tool-border': borderTint,
              '--tool-accent': accent,
              '--tool-shadow': shadow,
              '--side-color': sideColor,
            } as CSSProperties;
            const toolCls = [styles.toolDetail, isNew ? styles.newTool : styles.reused].join(' ');

            return (
              <details key={i} className={toolCls} style={detailStyle}>
                <summary className={styles.toolSummary}>
                  <div className={styles.toolSummaryMain}>
                    <div className={styles.toolSummaryHead}>
                      {isNew ? (
                        <span className={styles.toolNewBadge}>FORGED TOOL</span>
                      ) : (
                        <span className={styles.toolReusedBadge}>REUSED</span>
                      )}
                      {!isNew && t.firstForgedTurn != null && (
                        <span className={styles.toolFirstForged}>
                          first forged T{t.firstForgedTurn}
                          {t.firstForgedDepartment && t.firstForgedDepartment !== t.department
                            ? ` · ${t.firstForgedDepartment}`
                            : ''}
                        </span>
                      )}
                      {hasFullSchema && (
                        <span className={styles.toolSchemaBadge}>SCHEMA</span>
                      )}
                    </div>
                    <span className={styles.toolDescription}>
                      {String(t.description || t.name || '')}
                    </span>
                    <span className={styles.toolNameLine}>
                      {t.name} {t.mode ? `(${t.mode})` : ''}
                    </span>
                  </div>
                  <span className={approved ? styles.toolPassPill : styles.toolFailPill}>
                    {approved
                      ? `PASS ${(typeof t.confidence === 'number' ? t.confidence : 0.85).toFixed(2)}`
                      : 'RETRY'}
                  </span>
                </summary>
                {/* INSPECT lives OUTSIDE summary so axe doesn't flag it as
                    nested-interactive (summary is itself an interactive
                    toggle). Position is absolute so it visually overlays
                    the summary row; pointer-events stay independent of
                    the summary's toggle click. */}
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setInspectingTool(t.name || ''); }}
                  aria-label={`Inspect tool ${t.name || ''}`}
                  className={styles.toolInspectBtn}
                >
                  INSPECT
                </button>
                <div className={styles.toolBody}>
                  {t.crisis && (
                    <div className={styles.toolMetaRow}>
                      <span className={styles.toolMetaLabel}>CRISIS: </span>
                      {String(t.crisis)}
                    </div>
                  )}
                  {t.department && (
                    <div className={styles.toolMetaRow}>
                      <span className={styles.toolMetaLabel}>DEPT: </span>
                      {String(t.department)}
                    </div>
                  )}

                  {/* Input/output schemas — show the actual JSON Schema when
                      available (pulled from EmergentToolRegistry on first
                      forge), otherwise fall back to derived field names. */}
                  {(inputSchema || (Array.isArray(t.inputFields) && t.inputFields.length > 0)) && (
                    <SchemaBlock label="INPUT" color="var(--teal)" schema={inputSchema} fields={t.inputFields} />
                  )}
                  {(outputSchema || (Array.isArray(t.outputFields) && t.outputFields.length > 0)) && (
                    <SchemaBlock label="OUTPUT" color="var(--green)" schema={outputSchema} fields={t.outputFields} />
                  )}

                  {t.output && (
                    <details>
                      <summary className={styles.toolRawSummary} style={{ '--side-color': sideColor } as CSSProperties}>
                        Raw Output
                      </summary>
                      <pre className={styles.toolRawPre}>
                        {typeof t.output === 'object' ? JSON.stringify(t.output, null, 2) : String(t.output)}
                      </pre>
                    </details>
                  )}
                  {!t.output && !inputSchema && !outputSchema && (!t.inputFields || t.inputFields.length === 0) && (
                    <div className={styles.toolEmpty}>Tool forged but no output captured. The tool will be available for subsequent turns.</div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
        {inspectingTool && (
          <ToolDetailModal
            entry={toolRegistry.getEntry(inspectingTool)}
            fallbackName={inspectingTool}
            onClose={() => setInspectingTool(null)}
          />
        )}
        </>
      );
    }

    case 'outcome': {
      const outcome = String(dd.outcome || '');
      const decision = String(dd._decision || '');
      const rationale = String(dd._rationale || '');
      const reasoning = String(dd._reasoning || '');
      const policies = (dd._policies as string[]) || [];
      const systemDeltas = dd.systemDeltas as Record<string, number> | undefined;
      const turnNum = String(dd.turn || '');
      const toolCount = Number(dd._toolCount ?? 0);
      const citeCount = Number(dd._citeCount ?? 0);

      const outcomeStyle = {
        '--side-color': sideColor,
        '--outcome-bg': actorIndex === 0 ? 'rgba(232,180,74,.06)' : 'rgba(76,168,168,.06)',
        '--outcome-border': actorIndex === 0 ? 'var(--amber-dim)' : 'var(--teal-dim)',
      } as CSSProperties;

      return (
        <div className={styles.outcomeCard} style={outcomeStyle}>
          {/* Header: DECISION #N  tools · citations  BADGE */}
          <div className={styles.outcomeHead}>
            <span>
              <span className={styles.outcomeLabel}>DECISION #{turnNum}</span>
              <span className={styles.outcomeMeta}>
                {toolCount} tools &middot; {citeCount} citations
              </span>
            </span>
            <Badge outcome={outcome} />
          </div>
          {/* Decision text */}
          <div className={styles.outcomeText}>{decision}</div>
          {/* System deltas in teal mono */}
          {systemDeltas && Object.keys(systemDeltas).length > 0 && (
            <div className={styles.outcomeDeltas}>
              {Object.entries(systemDeltas).map(([k, v]) => (
                <span key={k} className={styles.outcomeDeltaSpan}>
                  {k} {v > 0 ? '+' : ''}{typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v}
                  {' · '}
                </span>
              ))}
            </div>
          )}
          {/* Expandable reasoning. `reasoning` is the full stepwise CoT
              (new in the Zod migration — previously stripped and
              discarded). `rationale` is the compressed one-paragraph
              summary. Show both in the expand: reasoning first (numbered
              steps render in the wrapping `div` as preformatted lines),
              then rationale, then policies. */}
          {(rationale || reasoning || policies.length > 0) && (
            <details>
              <summary className={styles.outcomeReasoningSummary}>
                Full reasoning &amp; policies
              </summary>
              <div className={styles.outcomeReasoningBody}>
                {reasoning && (
                  <div className={styles.outcomeReasoningPre}>{reasoning}</div>
                )}
                {decision && <div>{decision}</div>}
                {rationale && <div className={styles.outcomeRationale}>{rationale}</div>}
                {policies.map((p, i) => <div key={i} className={styles.outcomePolicyLine}>&rarr; {p}</div>)}
              </div>
            </details>
          )}
        </div>
      );
    }

    case 'personality_drift': {
      const entries = Object.values(dd.agents as Record<string, any> || {});
      if (!entries.length) return null;
      return (
        <div className={styles.driftRow}>
          <span className={styles.driftLabel}>DRIFT </span>
          {entries.slice(0, 3).map((c: any, i: number) => (
            <span key={i}>
              <span className={styles.driftName} style={sideStyle}>{c.name?.split(' ')[0]}</span>
              {' '}O{c.hexaco?.O ?? '?'} C{c.hexaco?.C ?? '?'}
              {i < Math.min(entries.length, 3) - 1 ? ' · ' : ''}
            </span>
          ))}
        </div>
      );
    }

    case 'agent_reactions': {
      const reactions = (dd.reactions as Array<Record<string, any>>) || [];
      const total = (dd.totalReactions as number) || reactions.length;
      if (!reactions.length) return null;

      const moodCounts: Record<string, number> = {};
      for (const r of reactions) moodCounts[r.mood] = (moodCounts[r.mood] || 0) + 1;
      const segments = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).map(([mood, count]) => ({
        mood, count, pct: Math.round((count / reactions.length) * 100), bg: moodBgColors[mood] || '#a89878',
      }));

      return (
        <details className={styles.reactionsDetails}>
          <summary className={styles.reactionsSummary}>
            <span className={styles.reactionsLabel} style={sideStyle}>{total} VOICES</span>
            <div className={styles.reactionsBar}>
              {segments.map(m => (
                <div
                  key={m.mood}
                  className={styles.reactionsBarSegment}
                  style={{ '--seg-flex': String(m.pct), '--seg-bg': m.bg } as CSSProperties}
                  title={`${m.pct}% ${m.mood}`}
                />
              ))}
            </div>
            <span className={styles.reactionsTopMood}>
              {segments[0] ? `${segments[0].pct}% ${segments[0].mood}` : ''}
            </span>
          </summary>
          <div className={styles.reactionsBody}>
          <div className={styles.reactionsLegend}>
            {segments.slice(0, 3).map(m => (
              <span key={m.mood} className={styles.reactionsLegendItem}>
                <span
                  className={styles.reactionsLegendSwatch}
                  style={{ '--swatch-bg': m.bg } as CSSProperties}
                />
                {m.pct}% {m.mood}
              </span>
            ))}
          </div>
          <details>
            <summary className={styles.reactionsQuotesSummary} style={sideStyle}>
              quotes ({reactions.length})
            </summary>
            <div className={styles.reactionsQuotesList}>
              {reactions.slice(0, 4).map((r, i) => (
                <Tooltip key={i} dot content={
                  <div>
                    <b className={styles.reactionTooltipName} style={sideStyle}>{r.name}</b>
                    <div className={styles.reactionTooltipMeta}>{r.role} in {r.department} {r.age ? `· Age ${r.age}` : ''}</div>
                    <div className={styles.reactionTooltipHexaco}>O:{r.hexaco?.O} C:{r.hexaco?.C} E:{r.hexaco?.E} A:{r.hexaco?.A} Em:{r.hexaco?.Em} HH:{r.hexaco?.HH}</div>
                    <div className={styles.reactionTooltipHealth}>Bone: {r.boneDensity}% · Radiation: {r.radiation}mSv · Psych: {r.psychScore}</div>
                    <div className={styles.reactionTooltipQuote}>&ldquo;{r.quote}&rdquo;</div>
                    <div
                      className={styles.reactionTooltipMoodLine}
                      style={{ '--mood-color': moodColors[r.mood] || 'var(--text-3)' } as CSSProperties}
                    >
                      {String(r.mood || '').toUpperCase()} · intensity {r.intensity?.toFixed?.(2) || '?'}
                    </div>
                    {r.memory?.beliefs?.length > 0 && (
                      <div className={styles.reactionTooltipBeliefs}>
                        Beliefs: {r.memory.beliefs.slice(0, 2).join('; ')}
                      </div>
                    )}
                  </div>
                }>
                  <div className={[styles.reactionRow, i < Math.min(reactions.length, 4) - 1 ? styles.notLast : ''].filter(Boolean).join(' ')}>
                    <span className={styles.reactionRowName} style={sideStyle}>{r.name}</span>
                    <span className={styles.reactionRowQuote}>
                      &ldquo;{String(r.quote || '')}&rdquo;
                    </span>
                    <span
                      className={styles.reactionRowMoodPill}
                      style={{ '--mood-color': moodColors[r.mood] || 'var(--text-3)' } as CSSProperties}
                    >
                      {String(r.mood || '').toUpperCase()}
                    </span>
                  </div>
                </Tooltip>
              ))}
            </div>
          </details>
          </div>
        </details>
      );
    }

    case 'bulletin': {
      const posts = (dd.posts as Array<Record<string, any>>) || [];
      if (!posts.length) return null;

      return (
        <details className={styles.bulletinDetails}>
          <summary className={styles.bulletinSummary}>
            <span className={styles.bulletinSummaryLabel}>{posts.length} POSTS</span>
            <span className={styles.bulletinSummaryNames}>
              {posts.slice(0, 2).map(p => String(p.name ?? '').split(' ')[0]).filter(Boolean).join(' · ')}
              {posts.length > 2 ? ` +${posts.length - 2}` : ''}
            </span>
          </summary>
          <div className={styles.bulletinBody}>
            {posts.slice(0, 3).map((p, i) => (
              <Tooltip key={i} dot content={
                <div>
                  <b className={styles.bulletinTooltipName} style={sideStyle}>{p.name}</b>{' '}
                  <span className={styles.bulletinTooltipRole}>{p.role} {p.department}</span>
                  <div className={styles.bulletinTooltipBody}>{p.post}</div>
                  <div
                    className={styles.bulletinTooltipMood}
                    style={{ '--mood-color': moodColors[p.mood] || 'var(--text-3)' } as CSSProperties}
                  >
                    {String(p.mood || '').toUpperCase()} · {p.likes || 0} likes · {p.replies || 0} replies
                  </div>
                </div>
              }>
                <div className={styles.bulletinRow}>
                  <span className={styles.bulletinName} style={sideStyle}>{p.name}</span>
                  <span className={styles.bulletinPost}>{String(p.post || '')}</span>
                  <span className={styles.bulletinLikes}>&hearts;{p.likes || 0}</span>
                </div>
              </Tooltip>
            ))}
          </div>
        </details>
      );
    }

    case 'turn_done':
      // Marker suppressed inside TurnGrid — the per-row header (T{n} +
      // diff badge) already communicates the turn boundary, so emitting
      // a footer marker per cell duplicates information AND creates a
      // visual hole in the column whose turn finished with fewer events
      // (the grid row stretches to match the taller cell's height, so a
      // short cell with a "Turn N complete" footer ends up showing 200+
      // px of empty space between its last real event and the marker).
      return null;

    case 'validation_fallback': {
      const schemaName = String(dd.schemaName || '<unknown>');
      const site = String(dd.site || '');
      const preview = String(dd.rawTextPreview || '');
      return (
        <details
          className={styles.fallbackDetails}
          style={sideStyle}
        >
          <summary className={styles.fallbackSummary}>
            <span className={styles.fallbackTitle}>⚠ SCHEMA FALLBACK — {schemaName}</span>
            <span className={styles.fallbackSite}>site: {site || 'n/a'}</span>
          </summary>
          {preview && (
            <details className={styles.fallbackPreviewWrap}>
              <summary className={styles.fallbackPreviewSummary}>Raw output preview</summary>
              <pre className={styles.fallbackPreviewPre}>{preview}</pre>
            </details>
          )}
        </details>
      );
    }

    default:
      return null;
  }
}

import type { ToolEntry } from '../../hooks/useToolRegistry';

/**
 * Modal that surfaces the full toolbox entry for a forged tool — schemas,
 * sample output, reuse counts, departments. Triggered by clicking a
 * forge_attempt card in the sim flow.
 */
function ToolDetailModal({ entry, fallbackName, onClose }: {
  entry: ToolEntry | undefined;
  fallbackName: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Tool detail · ${entry?.name || fallbackName}`}
      onClick={onClose}
      className={styles.modalBackdrop}
    >
      <div onClick={e => e.stopPropagation()} className={styles.modalDialog}>
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderLeft}>
            <div className={styles.modalKicker}>FORGED TOOL [{entry?.n ?? '?'}]</div>
            <div className={styles.modalTitle}>{entry?.name || fallbackName}</div>
            {entry?.description && entry.description !== entry.name && (
              <div className={styles.modalDescription}>{entry.description}</div>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className={styles.modalCloseBtn}>×</button>
        </div>

        <div className={styles.modalScroll}>
          {entry ? (
            <>
              <div className={styles.modalPills}>
                <Pill label={`${entry.mode}`} color="var(--text-3)" />
                <Pill label={entry.approved ? `PASS ${entry.confidence.toFixed(2)}` : 'RETRY'} color={entry.approved ? 'var(--green)' : 'var(--amber)'} />
                <Pill label={`first forged T${entry.firstForgedTurn} · ${entry.firstForgedDepartment}`} color="var(--amber)" />
                {entry.reuseCount > 0 && <Pill label={`reused ${entry.reuseCount}×`} color="var(--green)" />}
                {entry.departments.size > 0 && <Pill label={`used by ${[...entry.departments].join(', ')}`} color="var(--teal)" />}
              </div>

              {entry.inputSchema && (
                <ModalSection title="INPUT SCHEMA">
                  <pre className={styles.codePre}>{JSON.stringify(entry.inputSchema, null, 2)}</pre>
                </ModalSection>
              )}
              {entry.outputSchema && (
                <ModalSection title="OUTPUT SCHEMA">
                  <pre className={styles.codePre}>{JSON.stringify(entry.outputSchema, null, 2)}</pre>
                </ModalSection>
              )}
              {!entry.inputSchema && !entry.outputSchema && (entry.inputFields.length > 0 || entry.outputFields.length > 0) && (
                <ModalSection title="FIELDS (DERIVED)">
                  <div className={styles.fieldsBlock}>
                    {entry.inputFields.length > 0 && <div><span className={styles.fieldsLabelIn}>in:</span> {entry.inputFields.join(', ')}</div>}
                    {entry.outputFields.length > 0 && <div><span className={styles.fieldsLabelOut}>out:</span> {entry.outputFields.join(', ')}</div>}
                  </div>
                </ModalSection>
              )}
              {/* Reuse timeline — every invocation across the run with
                  turn, dept, event title, and output. Re-forge attempts
                  are flagged separately from pure citations so the user
                  can see when the LLM re-ran the judge vs cited an
                  existing tool. */}
              {entry.history && entry.history.length > 0 && (
                <ModalSection title={`USAGE HISTORY · ${entry.history.length} invocation${entry.history.length === 1 ? '' : 's'}`}>
                  <ol className={styles.usageList}>
                    {entry.history.map((h, i) => {
                      const accent = h.rejected ? 'var(--rust)' : h.isReforge ? 'var(--amber)' : 'var(--green)';
                      return (
                        <li
                          key={i}
                          className={styles.usageItem}
                          style={{ '--usage-accent': accent } as CSSProperties}
                        >
                          <div className={styles.usageHeader}>
                            <span className={styles.usageTurn}>T{h.turn}</span>
                            <span className={styles.usageTime}>{h.time}</span>
                            <span className={styles.usageDept}>{h.department}</span>
                            <span className={styles.usageEvent}>· {h.eventTitle}</span>
                            <span className={styles.usageStatus}>
                              <span
                                className={styles.usageStatusBadge}
                                style={{ '--status-color': accent } as CSSProperties}
                              >
                                {h.rejected ? 'JUDGE REJECTED' : h.isReforge ? 'RE-FORGE' : i === 0 ? 'FORGE' : 'REUSE'}
                              </span>
                              {typeof h.confidence === 'number' && (
                                <span className={styles.usageConf}>conf {h.confidence.toFixed(2)}</span>
                              )}
                            </span>
                          </div>
                          {h.output && (
                            <div className={styles.usageOutput}>
                              {h.output.length > 200 ? h.output.slice(0, 200) + '…' : h.output}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </ModalSection>
              )}

              {entry.sampleOutput && (
                <ModalSection title="LATEST OUTPUT">
                  <pre className={styles.codePre}>{entry.sampleOutput}</pre>
                </ModalSection>
              )}
            </>
          ) : (
            <div className={styles.modalEmpty}>
              Tool entry not yet in the registry — the specialist_done summary
              for this forge hasn't arrived yet. Try again in a moment.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className={styles.pill} style={{ '--pill-color': color } as CSSProperties}>
      {label}
    </span>
  );
}

function ModalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.modalSection}>
      <div className={styles.modalSectionTitle}>{title}</div>
      {children}
    </div>
  );
}

/**
 * Render an INPUT or OUTPUT block for a forged tool.
 *
 * Prefers the actual JSON Schema (pulled from EmergentToolRegistry on
 * first forge) when available, falling back to a simple field-name list
 * derived from the tool's last invocation.
 */
function SchemaBlock({ label, color, schema, fields }: {
  label: 'INPUT' | 'OUTPUT';
  color: string;
  schema?: unknown;
  fields?: string[];
}) {
  const props = (schema && typeof schema === 'object' && (schema as any).properties) || null;
  const required: string[] = (schema && typeof schema === 'object' && Array.isArray((schema as any).required))
    ? (schema as any).required
    : [];

  // No real schema → render the legacy field-name list
  if (!props) {
    if (!fields || fields.length === 0) return null;
    return (
      <div className={styles.schemaBlock}>
        <span
          className={styles.schemaFieldsLabel}
          style={{ '--field-color': color } as CSSProperties}
        >
          {label} FIELDS:{' '}
        </span>
        <span className={styles.schemaFieldsList}>{fields.join(', ')}</span>
      </div>
    );
  }

  const entries = Object.entries(props as Record<string, any>).slice(0, 12);
  return (
    <div className={styles.schemaBlock}>
      <div
        className={styles.schemaTitle}
        style={{ '--field-color': color } as CSSProperties}
      >
        {label} SCHEMA
      </div>
      <table className={styles.schemaTable}>
        <tbody>
          {entries.map(([key, def]) => {
            const type = String(def?.type ?? 'any');
            const desc = typeof def?.description === 'string' ? def.description : '';
            const isRequired = required.includes(key);
            return (
              <tr key={key} className={styles.schemaRow}>
                <td className={styles.schemaKeyCell}>
                  {key}
                  {isRequired && <span className={styles.schemaRequired}>*</span>}
                </td>
                <td className={styles.schemaTypeCell} style={{ '--field-color': color } as CSSProperties}>
                  {type}
                </td>
                <td className={styles.schemaDescCell}>{desc}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
