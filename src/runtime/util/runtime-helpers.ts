import type { ScenarioLabels } from '../../engine/types.js';
import { scenarioWords } from './scenario-words.js';

/** A department as the promotion prompt names it. */
export interface PromotionDepartment {
  id: string;
  label: string;
  role: string;
}

/**
 * The turn-0 prompt that asks the commander to name one head for each
 * department the run keeps.
 *
 * It names each department by its id and its label and asks for the id,
 * counts the departments it lists, and takes its noun for the people and
 * its example from the scenario. It used to say "promote 5 colonists"
 * with "medical" and "Chief Medical Officer" as its example in every
 * scenario, and Atlas Lab commanders answered with department labels,
 * short forms and a "Director of Colonial Communications".
 */
export function buildPromotionPrompt(
  candidateSummaries: string,
  departments: PromotionDepartment[],
  labels?: Partial<ScenarioLabels>,
): string {
  const { population } = scenarioWords(labels);
  const first = departments[0];
  const list = departments
    .map(d => `- "${d.id}": ${d.label} (head: ${d.role})`)
    .join('\n');
  const example = first
    ? `{"agentId":"<the id in parentheses after the person's name>","department":"${first.id}","role":"${first.role}","reason":"..."}`
    : '{"agentId":"<the id in parentheses after the person\'s name>","department":"<department id>","role":"...","reason":"..."}';
  const count = departments.length === 1 ? `one of your ${population}` : `${departments.length} ${population}`;
  return `You must promote ${count} to department head roles, one head for each department below. Evaluate these candidates based on their personality traits and specialization. Choose people who align with YOUR leadership style.

DEPARTMENTS (write the quoted id in "department", exactly as shown):
${list}

${candidateSummaries}

Return JSON: {"promotions":[${example},...]}. Use each department id once, and copy each agentId exactly as the candidate list shows it.`;
}

export function applyCustomEventToCrisis<T extends { description: string; turnSummary: string; crisis?: string }>(
  crisis: T,
  customEvents: Array<{ turn: number; title: string; description: string }>,
  turn: number,
): T {
  const matches = customEvents.filter(event => event.turn === turn);
  if (!matches.length) return crisis;

  const injected = matches
    .map(event => `USER EVENT: ${event.title} — ${event.description}`)
    .join('\n');
  const suffix = matches.map(event => event.title).join(', ');
  const baseText = crisis.crisis || crisis.description;

  return {
    ...crisis,
    description: `${crisis.description}\n\n${injected}`,
    crisis: baseText ? `${baseText}\n\n${injected}` : undefined,
    turnSummary: crisis.turnSummary
      ? `${crisis.turnSummary} | user event: ${suffix}`
      : `user event: ${suffix}`,
  };
}

export function buildTimeSchedule(startTime: number, maxTurns: number, timePerTurn?: number): number[] {
  if (timePerTurn != null && timePerTurn > 0) {
    return Array.from({ length: maxTurns }, (_, i) => startTime + i * timePerTurn);
  }
  // Default: accelerating schedule (2, 3, 3, 3, 3, 4, 5, 5, 5, 7, 10 time gaps)
  const offsets = [0, 2, 5, 8, 11, 14, 18, 23, 28, 33, 40, 50];
  return Array.from({ length: maxTurns }, (_, index) => {
    const offset = offsets[index] ?? (offsets[offsets.length - 1] + (index - offsets.length + 1) * 5);
    return startTime + offset;
  });
}
