import type { Department, SimulationState, Agent } from '../../engine/core/state.js';
import type { DepartmentReport, CrisisResearchPacket } from '../contracts.js';
import type { Scenario } from '../../engine/types.js';
import { buildTrajectoryCue } from '../hexaco-cues/trajectory.js';

/** Summary of a department's previous turn for session continuity */
export interface DepartmentTurnMemory {
  turn: number;
  time: number;
  crisis: string;
  summary: string;
  recommendedActions: string[];
  outcome: string;
  toolsForged: string[];
}

export function buildDepartmentContext(
  dept: Department,
  state: SimulationState,
  scenario: Scenario,
  researchPacket: CrisisResearchPacket,
  previousTurns?: DepartmentTurnMemory[],
  departmentPromptHook?: (ctx: { department: string; state: SimulationState; scenario: Scenario; researchPacket: CrisisResearchPacket }) => string[],
): string {
  const alive = state.agents.filter(c => c.health.alive);
  const featured = alive.filter(c => c.narrative.featured);
  const deptNote = researchPacket.departmentNotes[dept] || '';

  // Inject promoted leader's evolving HEXACO profile plus the behavioural
  // cues that match THIS dept head's actual trait values. Firing cues
  // conditionally (O > 0.7 → explore more, O < 0.3 → stay with proven)
  // produces sharper asymmetry than listing every axis's high-low
  // guidance and asking the model to weight them. Earlier runs showed
  // both leaders converging on similar forge counts; conditional cues
  // steer each dept head's behaviour more directly.
  const leader = state.agents.find(c => c.promotion?.department === dept && c.health.alive);
  const hexacoBlock: string[] = [];
  if (leader) {
    const h = leader.hexaco;
    const cues: string[] = [];

    // Openness: the single strongest signal for forge-vs-reuse
    if (h.openness > 0.7) {
      cues.push('Your high openness invites exploration. When this event involves any analysis the current toolbox does not exactly cover, forge a new tool with a fresh angle or composed logic. Default to forging; reuse only when an existing tool produces EXACTLY the analysis you need unchanged.');
    } else if (h.openness < 0.3) {
      cues.push('Your low openness favours proven methods. Trust the existing toolbox. Reuse tools whenever their scope overlaps the current analysis. Forge a new tool only when an existing one would clearly mislead you on this specific event.');
    } else {
      cues.push('Your moderate openness balances reuse and forge. Prefer reusing when the existing tool fits; forge when a new angle would produce a materially different reading.');
    }

    // Conscientiousness: thoroughness + evidence standard
    if (h.conscientiousness > 0.7) {
      cues.push('Your high conscientiousness demands evidence and procedure. Your reports lead with uncertainty ranges and explicit assumptions. When forging is the right call, your test cases cover the boundary conditions the judge will probe. When reusing, you call out whether the reused tool\'s prior output still applies.');
    } else if (h.conscientiousness < 0.3) {
      cues.push('Your low conscientiousness accepts ambiguity. Move fast. Your reports name the top risk without inventorying the tail. You skip forging when a rough inference from existing data suffices; you forge quickly (single test case, minimal schema) when you need a number now.');
    }

    // Extraversion: report tone
    if (h.extraversion > 0.7) {
      cues.push('Your high extraversion writes with assertive voice: strong verbs, top-line recommendation first, clear advocacy for your chosen path.');
    } else if (h.extraversion < 0.3) {
      cues.push('Your low extraversion writes with measured voice: tradeoffs first, recommendation at the end, space for the commander to disagree.');
    }

    // Agreeableness: cross-dept framing
    if (h.agreeableness > 0.7) {
      cues.push('Your high agreeableness frames recommendations as proposals that acknowledge other departments\' constraints; flag cross-department coordination risks explicitly.');
    } else if (h.agreeableness < 0.3) {
      cues.push('Your low agreeableness writes direct recommendations without diplomatic hedging; treat cross-department friction as the other dept\'s problem to solve.');
    }

    // Emotionality: human impact weighting
    if (h.emotionality > 0.7) {
      cues.push('Your high emotionality weighs human impact heavily. Elevate morale, mental health, and mortality risks even when numerically small. Reject options that accept casualties for efficiency.');
    } else if (h.emotionality < 0.3) {
      cues.push('Your low emotionality treats headcount as a capacity number. Recommend options that trade individual mortality for structural colony survival when the math supports it.');
    }

    // Honesty-Humility: certainty presentation
    if (h.honestyHumility > 0.7) {
      cues.push('Your high honesty-humility exposes data gaps and low-confidence assumptions openly. Do not inflate certainty for the commander\'s benefit.');
    } else if (h.honestyHumility < 0.3) {
      cues.push('Your low honesty-humility presents recommendations with more confidence than the raw data strictly warrants when doing so advances the colony\'s strategic interest.');
    }

    hexacoBlock.push(
      '',
      'YOUR PERSONALITY PROFILE (evolves over time based on leadership and experience):',
      `Openness: ${h.openness.toFixed(2)} | Conscientiousness: ${h.conscientiousness.toFixed(2)} | Extraversion: ${h.extraversion.toFixed(2)}`,
      `Agreeableness: ${h.agreeableness.toFixed(2)} | Emotionality: ${h.emotionality.toFixed(2)} | Honesty-Humility: ${h.honestyHumility.toFixed(2)}`,
    );
    const trajectory = buildTrajectoryCue(leader.hexacoHistory, leader.hexaco);
    if (trajectory) hexacoBlock.push(trajectory);
    hexacoBlock.push(...cues, '');
  }

  // Build memory block from previous turns
  const memoryBlock: string[] = [];
  if (previousTurns?.length) {
    memoryBlock.push('', 'YOUR PREVIOUS ANALYSES (remember what you recommended and what happened):');
    for (const m of previousTurns.slice(-3)) {
      memoryBlock.push(`  Turn ${m.turn} (${m.time}): "${m.crisis}" → ${m.outcome}`);
      if (m.summary) memoryBlock.push(`    Your analysis: ${m.summary.slice(0, 120)}`);
      if (m.recommendedActions.length) memoryBlock.push(`    You recommended: ${m.recommendedActions.slice(0, 2).join('; ')}`);
      if (m.toolsForged.length) memoryBlock.push(`    Tools you forged: ${m.toolsForged.join(', ')}`);
    }
    memoryBlock.push('Build on your previous work. Reference your past tools and recommendations where relevant.', '');
  }

  const lines = [
    `TURN ${state.metadata.currentTurn} — YEAR ${state.metadata.currentTime}: ${scenario.title}`,
    ...hexacoBlock,
    ...memoryBlock,
    '', scenario.crisis, '',
    'RESEARCH:',
    ...researchPacket.canonicalFacts.map(f => `- ${f.claim} [${f.source}](${f.url})`),
    ...(researchPacket.counterpoints.length ? ['COUNTERPOINTS:', ...researchPacket.counterpoints.map(c => `- ${c.claim} [${c.source}](${c.url})`)] : []),
    ...(deptNote ? [`NOTE: ${deptNote}`] : []),
    '',
    `STATE: Pop ${state.metrics.population} | Morale ${Math.round(state.metrics.morale * 100)}% | Food ${state.metrics.foodMonthsReserve.toFixed(1)}mo | Water ${state.metrics.waterLitersPerDay} L/day | Power ${state.metrics.powerKw} kW | Modules ${state.metrics.infrastructureModules} | Life support ${state.metrics.lifeSupportCapacity}`,
    '',
  ];

  // Domain-specific department context: from scenario hook or fallback
  if (departmentPromptHook) {
    const hookLines = departmentPromptHook({ department: dept, state, scenario, researchPacket });
    lines.push(...hookLines);
  }

  return lines.join('\n');
}

export function getDepartmentsForTurn(turn: number): Department[] {
  const deps: Department[] = ['medical', 'engineering'];
  if ([2, 3, 4, 8, 11, 12].includes(turn)) deps.push('agriculture');
  if ([4, 6, 8, 9, 11, 12].includes(turn)) deps.push('psychology');
  if (turn >= 9) deps.push('governance');
  return deps;
}
