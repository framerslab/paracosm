/**
 * @fileoverview Generate a short narrative title for a saved session
 * using the cheapest-tier model available. Titles surface in the LOAD
 * menu so cached runs read as "Aria's Cautious Descent" instead of the
 * default "Aria Chen vs Dietrich Voss — Apr 19, 3:50 PM".
 *
 * Runs off the main save path: `autoSaveOnComplete` inserts the row,
 * then fires this helper async; a failed title call leaves `title`
 * null and the LoadMenu falls back to scenarioName or the deterministic
 * composite label. No retries — one nano-tier call, bounded 60 output
 * tokens, total expected cost ≈ $0.0001 / run.
 *
 * @module paracosm/cli/session-title
 */
import type { TimestampedEvent } from './stores/session.js';

/** Model id used for title generation per provider family. */
export interface TitleModelConfig {
  provider: 'openai' | 'anthropic';
  model: string;
}

/** Smallest deployed-tier models for each provider. Kept in lockstep
 *  with sim-config.ts's `cheap` economics tier so we don't introduce
 *  a separate nano-tier model matrix. */
export const DEFAULT_TITLE_MODELS: Record<'openai' | 'anthropic', string> = {
  openai: 'gpt-5.4-nano',
  anthropic: 'claude-haiku-4-5-20251001',
};

interface RunHighlights {
  scenarioName: string;
  leaderA?: string;
  leaderB?: string;
  archetypeA?: string;
  archetypeB?: string;
  turnCount?: number;
  winner?: string;
  headline?: string;
  finalPopA?: number;
  finalPopB?: number;
  finalMoraleA?: number;
  finalMoraleB?: number;
  deathsA?: number;
  deathsB?: number;
  forgedA?: number;
  forgedB?: number;
  firstCrisis?: string;
  aborted?: boolean;
}

/** Parse an SSE frame line into `{event, data}`. Returns null when the
 *  line is malformed or data is not valid JSON. Tolerates the leading
 *  whitespace that server-app occasionally emits. */
function parseFrame(sse: string): { event: string; data: Record<string, unknown> } | null {
  const lines = sse.split('\n');
  if (lines.length < 2) return null;
  const event = lines[0]?.replace(/^event:\s*/, '').trim();
  const dataLine = lines[1]?.replace(/^data:\s*/, '');
  if (!event || !dataLine) return null;
  try {
    return { event, data: JSON.parse(dataLine) as Record<string, unknown> };
  } catch {
    return null;
  }
}

/**
 * Walk the event buffer once and pull out the highlights an LLM needs
 * to write a compelling title. Keeps the prompt small (~300 tokens)
 * rather than shoveling the full event JSON in.
 */
export function summariseForTitle(events: TimestampedEvent[]): RunHighlights {
  const out: RunHighlights = { scenarioName: 'Run' };
  let lastSystemsA: Record<string, unknown> | null = null;
  let lastSystemsB: Record<string, unknown> | null = null;
  let lastForgedA = 0;
  let lastForgedB = 0;
  let lastDeathsA = 0;
  let lastDeathsB = 0;
  for (const { sse } of events) {
    const parsed = parseFrame(sse);
    if (!parsed) continue;
    const { event, data } = parsed;
    if (event === 'active_scenario' && typeof data.name === 'string') {
      out.scenarioName = data.name;
    }
    if (event === 'status' && data.phase === 'parallel') {
      const actors = Array.isArray(data.leaders)
        ? (data.leaders as Array<{ name?: string; archetype?: string }>)
        : [];
      if (typeof actors[0]?.name === 'string') out.leaderA = actors[0].name;
      if (typeof actors[1]?.name === 'string') out.leaderB = actors[1].name;
      if (typeof actors[0]?.archetype === 'string') out.archetypeA = actors[0].archetype;
      if (typeof actors[1]?.archetype === 'string') out.archetypeB = actors[1].archetype;
    }
    const isSim = event === 'sim';
    const innerType = isSim && typeof data.type === 'string' ? data.type : null;
    if (innerType === 'turn_done') {
      const turn = typeof data.turn === 'number' ? data.turn : undefined;
      if (typeof turn === 'number' && turn > (out.turnCount ?? 0)) out.turnCount = turn;
      const systems = (data.metrics ?? null) as Record<string, unknown> | null;
      const leader = typeof data.leader === 'string' ? data.leader : '';
      if (systems) {
        if (leader && leader === out.leaderA) lastSystemsA = systems;
        else if (leader && leader === out.leaderB) lastSystemsB = systems;
      }
      if (typeof data.deaths === 'number') {
        if (leader === out.leaderA) lastDeathsA += data.deaths;
        else if (leader === out.leaderB) lastDeathsB += data.deaths;
      }
    }
    if (innerType === 'event_start' && !out.firstCrisis) {
      const title = typeof data.title === 'string' ? data.title : '';
      const category = typeof data.category === 'string' ? data.category : '';
      if (title) out.firstCrisis = category ? `${title} (${category})` : title;
    }
    if (innerType === 'forge_attempt' && data.approved === true) {
      const leader = typeof data.leader === 'string' ? data.leader : '';
      if (leader === out.leaderA) lastForgedA += 1;
      else if (leader === out.leaderB) lastForgedB += 1;
    }
    if (event === 'verdict') {
      // Verdict SSE carries a `winner` leader name and a short headline
      // the pair-runner assembled. Exact shape is `{ winner: string,
      // headline: string, ...}`. Null-safe extraction.
      if (typeof data.winner === 'string') out.winner = data.winner;
      if (typeof data.headline === 'string') out.headline = data.headline;
    }
    if (event === 'complete' && data.aborted === true) {
      out.aborted = true;
    }
  }
  if (lastSystemsA) {
    const pop = typeof lastSystemsA.population === 'number' ? lastSystemsA.population : undefined;
    const mor = typeof lastSystemsA.morale === 'number' ? lastSystemsA.morale : undefined;
    if (typeof pop === 'number') out.finalPopA = pop;
    if (typeof mor === 'number') out.finalMoraleA = mor;
  }
  if (lastSystemsB) {
    const pop = typeof lastSystemsB.population === 'number' ? lastSystemsB.population : undefined;
    const mor = typeof lastSystemsB.morale === 'number' ? lastSystemsB.morale : undefined;
    if (typeof pop === 'number') out.finalPopB = pop;
    if (typeof mor === 'number') out.finalMoraleB = mor;
  }
  if (lastDeathsA > 0) out.deathsA = lastDeathsA;
  if (lastDeathsB > 0) out.deathsB = lastDeathsB;
  if (lastForgedA > 0) out.forgedA = lastForgedA;
  if (lastForgedB > 0) out.forgedB = lastForgedB;
  return out;
}

/**
 * Build the user prompt passed to the title LLM. Short, structured,
 * and biased toward narrative rather than stat-recap because the
 * LoadMenu card already shows leader names + turn count separately.
 */
export function buildTitlePrompt(h: RunHighlights): string {
  const lines: string[] = [
    `Scenario: ${h.scenarioName}`,
    h.leaderA && h.archetypeA ? `Leader A: ${h.leaderA} (${h.archetypeA})` : null,
    h.leaderB && h.archetypeB ? `Leader B: ${h.leaderB} (${h.archetypeB})` : null,
    h.turnCount ? `Turns completed: ${h.turnCount}${h.aborted ? ' (aborted mid-run)' : ''}` : null,
    h.winner ? `Winner: ${h.winner}` : null,
    h.headline ? `Verdict headline: ${h.headline}` : null,
    h.firstCrisis ? `Opening crisis: ${h.firstCrisis}` : null,
    h.finalPopA != null || h.finalPopB != null
      ? `Final populations: A=${h.finalPopA ?? '?'}, B=${h.finalPopB ?? '?'}`
      : null,
    h.finalMoraleA != null || h.finalMoraleB != null
      ? `Final morale: A=${h.finalMoraleA != null ? Math.round(h.finalMoraleA * 100) + '%' : '?'}, B=${h.finalMoraleB != null ? Math.round(h.finalMoraleB * 100) + '%' : '?'}`
      : null,
    h.deathsA || h.deathsB ? `Deaths: A=${h.deathsA ?? 0}, B=${h.deathsB ?? 0}` : null,
    h.forgedA || h.forgedB ? `Tools forged: A=${h.forgedA ?? 0}, B=${h.forgedB ?? 0}` : null,
  ].filter((l): l is string => l != null);
  return [
    'Write a single short, punchy, narrative title for this simulation run. 3-7 words. No quotes, no trailing punctuation, no hashtags. Evoke the story, not the stats (stats are shown separately). Examples of good titles: "Aria\'s Cautious Descent", "Engineering Wins on Turn 4", "Voss Holds the Line".',
    '',
    'Run summary:',
    ...lines,
    '',
    'Title:',
  ].join('\n');
}

/** Cleanup pass on raw LLM output: strip quotes, trailing punct, model
 *  preambles ("Here\'s the title:"). Returns empty string when the
 *  model produced nothing usable. */
export function cleanTitle(raw: string): string {
  let t = raw.trim();
  // Strip leading "Title:" / "Here is a title:" / markdown.
  t = t.replace(/^(title|here(?:'s| is| are)? (?:a |the )?title)[:\-—]?\s*/i, '');
  // Keep only the first line — some small models emit title + explanation.
  t = t.split('\n')[0]?.trim() ?? '';
  // Iteratively peel quotes/markdown/whitespace AND terminal punctuation
  // until nothing strips on a pass. A single-pass regex misses cases
  // like `"Title".` where the order of removal matters: strip `.` and
  // the trailing quote is exposed for the next iteration.
  for (let i = 0; i < 5; i += 1) {
    const before = t;
    t = t.replace(/^[#*`>"'\s]+/, '').replace(/[#*`>"'\s]+$/, '');
    t = t.replace(/[.!?,;:]+$/, '');
    if (t === before) break;
  }
  return t.slice(0, 120);
}

/**
 * Deterministic fallback title. Used when the LLM call fails or
 * returns empty after cleanup, so the LoadMenu still reads as
 * something other than "Untitled run".
 */
export function fallbackTitle(h: RunHighlights): string {
  const parts: string[] = [];
  if (h.leaderA && h.leaderB) {
    parts.push(`${h.leaderA} vs ${h.leaderB}`);
  } else if (h.leaderA) {
    parts.push(h.leaderA);
  }
  if (h.scenarioName) parts.push(h.scenarioName);
  if (h.turnCount) parts.push(`T${h.turnCount}`);
  if (h.aborted) parts.push('(unfinished)');
  return parts.length > 0 ? parts.join(' · ') : 'Simulation Run';
}

/**
 * Invoke the title LLM once, clean the response, return the final
 * title. Returns `null` when the call errored or produced nothing
 * usable — caller should leave the row titleless rather than
 * overwriting with empty string.
 */
export async function generateSessionTitle(
  events: TimestampedEvent[],
  provider: 'openai' | 'anthropic',
  runGenerateText: (args: { provider: string; model: string; prompt: string }) => Promise<{ text: string }>,
  modelOverride?: string,
): Promise<string | null> {
  const highlights = summariseForTitle(events);
  const prompt = buildTitlePrompt(highlights);
  const model = modelOverride ?? DEFAULT_TITLE_MODELS[provider];
  try {
    const { text } = await runGenerateText({ provider, model, prompt });
    const cleaned = cleanTitle(text ?? '');
    if (!cleaned) return null;
    return cleaned;
  } catch {
    return null;
  }
}
