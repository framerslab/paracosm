import type { DecisionBarCheck, GameState, LeaderInfo } from '../../hooks/useGameState';
import { isAiWrittenPassage } from '../shared/authorship';

export interface PairDecision {
  crisis?: Record<string, unknown>;
  outcome?: Record<string, unknown>;
  choice?: Record<string, unknown>;
  barCheck?: DecisionBarCheck;
  reports: Map<string, Record<string, unknown> | undefined>;
  priorFigures?: Record<string, number>;
}

export interface PairTurnData {
  leaders: Array<{ name: string; info: LeaderInfo | null }>;
  time?: number;
  crises: Array<{ index: number; sides: Array<PairDecision | undefined> }>;
}

export function pairTurnAt(state: GameState, turn: number): PairTurnData {
  const leaders = state.actorIds.slice(0, 2).map(name => ({ name, info: state.actors[name]?.leader ?? null }));
  const byIndex = new Map<number, PairTurnData['crises'][number]>();
  let time: number | undefined;
  for (const [place, { name }] of leaders.entries()) {
    const actor = state.actors[name];
    const events = actor?.events ?? [];
    const decisions = actor?.decisionEvents?.values() ?? [];
    let prior: { turn: number; figures: Record<string, number> } | undefined;
    for (const event of [...events, ...decisions]) {
      if (typeof event.turn !== 'number') continue;
      const { data } = event;
      if (event.turn < turn && event.type === 'turn_done' && data.metrics &&
          (!prior || event.turn >= prior.turn)) {
        prior = { turn: event.turn, figures: data.metrics as Record<string, number> };
      }
      if (event.turn !== turn) continue;
      time ??= event.time;
      const type = event.type;
      if (!['turn_start', 'event_start', 'specialist_start', 'specialist_done', 'decision_made', 'outcome'].includes(type)) continue;
      if (type === 'turn_start' && (!data.title || data.title === 'Director generating...')) continue;
      const index = Number(data.eventIndex ?? 0);
      let crisis = byIndex.get(index);
      if (!crisis) byIndex.set(index, crisis = { index, sides: [] });
      const side: PairDecision = crisis.sides[place] ??= { reports: new Map(), priorFigures: prior?.figures };
      if (type === 'event_start' || type === 'turn_start') {
        side.crisis = type === 'event_start' ? data : { ...data, description: data.crisis };
      } else if (type === 'specialist_start' || type === 'specialist_done') {
        if (typeof data.department === 'string') {
          side.reports.set(data.department, type === 'specialist_done' ? data : undefined);
        }
      } else if (type === 'decision_made') {
        side.choice = data;
      } else if (type === 'outcome') {
        if (data._decision && !side.choice) {
          side.choice = {
            decision: data._decision, rationale: data._rationale, reasoning: data._reasoning,
            selectedPolicies: data._policies, aiWrittenFields: data.aiWrittenFields,
          };
        }
        side.outcome = data;
        side.barCheck = data._barCheck as DecisionBarCheck | undefined;
      }
    }
  }
  return { leaders, time, crises: Array.from(byIndex.values()).sort((a, b) => a.index - b.index) };
}

export function hasChoice(data: Record<string, unknown> | undefined): boolean {
  return Boolean(data && typeof data.decision === 'string' && data.decision.trim() &&
    (Array.isArray(data.aiWrittenFields) ? data.aiWrittenFields.length > 0 : isAiWrittenPassage(data, 'decision', data.decision)));
}
