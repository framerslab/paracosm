import { renderPersonalityDirectives } from '@framers/agentos';
import { buildSystemPrompt } from '@framers/agentos/api/agent';
import type { LeaderPromptAnswer } from '../../api/leader-prompt.js';
import { applyDemoCaps, countMissingOrders, DEMO_PROVIDER, normalizeSimulationConfig } from '../../cli/sim-config.js';
import { MAX_ORDER_CHARS } from '../../engine/presets/fill-instructions.js';
import { normalizeActorConfig, traitsToHexaco } from '../../engine/traits/normalize-leader.js';
import type { ActorInput, ScenarioPackage } from '../../engine/types.js';
import {
  buildCommanderBootstrap,
  buildCommanderTurnPrompt,
  buildDecisionRule,
  buildPersonalityCue,
  commanderAgentOptions,
  decisionRuleNumbers,
  type DecisionRuleArgs,
} from '../../runtime/orchestrator/commander-prompt.js';
import { createRunKernel } from '../../runtime/orchestrator/run-kernel.js';
import { buildTimeSchedule } from '../../runtime/util/runtime-helpers.js';
import { formatStateLine } from '../../runtime/util/scenario-state.js';
import { hostedRunModels } from '../hosted-model-policy.js';

type WrittenLeader = Omit<ActorInput, 'unit'> & { unit?: string };
type PromptMode = 'host' | 'own' | 'server';

/** The optional, credential-free preview selection made by the card. */
export const PROMPT_MODE_HEADER = 'X-Paracosm-Prompt-Mode';

function writtenLeaders(scenario: ScenarioPackage): readonly WrittenLeader[] {
  // Older compiled packages use actors. The current JSON may carry a trait
  // profile in place of the legacy HEXACO field.
  const preset = scenario.presets[0] as {
    leaders?: readonly WrittenLeader[];
    actors?: readonly WrittenLeader[];
  } | undefined;
  return preset?.leaders ?? preset?.actors ?? [];
}

/** The number of written places in the same first preset Start reads. */
export function writtenLeaderCount(scenario: ScenarioPackage): number {
  return writtenLeaders(scenario).length;
}

function actorForPreview({ unit: _unit, ...leader }: WrittenLeader): ActorInput {
  // Start leaves the unit out of its setup payload.
  return leader as ActorInput;
}

const sampleOptions = [
  { id: 'bold', label: 'Try the new approach', isRisky: true },
  { id: 'safe', label: 'Keep the current approach', isRisky: false },
] as const;
const sampleOptionText = '\n\nOPTIONS:\n'
  + sampleOptions.map(option => `- ${option.id}: ${option.label}${option.isRisky ? ' [RISKY]' : ''}`).join('\n')
  + '\n\nYou MUST include "selectedOptionId" in your JSON response.';

/** Project an admitted written place through the same configuration and input builders as a run. */
export function buildWrittenLeaderPrompt(
  scenario: ScenarioPackage,
  place: number,
  mode: PromptMode,
  hostedDemo: boolean,
): LeaderPromptAnswer {
  const leaders = writtenLeaders(scenario);
  const source = actorForPreview(leaders[place - 1]);
  // Normalization requires a pair. Keep the selected place through the cap,
  // even when a preset lists just one leader or more than the demo runs.
  const companion = leaders[place === 1 ? 1 : 0];
  const config = normalizeSimulationConfig({
    actors: [source, companion ? actorForPreview(companion) : source],
    seed: scenario.setup.defaultSeed ?? 42,
  }, scenario);
  const run = mode === 'host' ? applyDemoCaps(config) : config;
  const leader = run.actors[0];
  const normalized = normalizeActorConfig(leader);
  const hexaco = leader.hexaco ?? traitsToHexaco(normalized.traitProfile.traits);
  const withBar = normalized.traitProfile.modelId === 'hexaco';
  const options = commanderAgentOptions(leader, hexaco);
  const system = buildSystemPrompt(options);
  if (system === undefined) throw new Error('The commander has no system prompt');

  const scores = withBar ? renderPersonalityDirectives(options.personality).map(({ trait, line }) => ({
    trait: trait === 'honesty' ? 'honesty-humility' as const : trait,
    value: Number(options.personality[trait].toFixed(2)),
    line,
  })) : [];
  const metrics = createRunKernel(run, leader, scenario).getState().metrics;
  const ruleArgs: DecisionRuleArgs = {
    hexaco,
    options: sampleOptions,
    riskSuccessProbability: 0.5,
    metrics,
    withBar,
  };

  return {
    scenarioId: scenario.id,
    place,
    name: leader.name,
    filled: countMissingOrders([source], mode === 'host' ? MAX_ORDER_CHARS : undefined) > 0,
    parts: {
      system,
      opening: buildCommanderBootstrap(buildPersonalityCue(hexaco), scenario.labels),
      sampleTurn: buildCommanderTurnPrompt({
        turn: 1,
        time: buildTimeSchedule(run.startTime, run.turns, run.timePerTurn)[0],
        eventLabel: '',
        title: "[this turn's event]",
        description: '',
        summaries: '[the department reports, written during the run]',
        toolboxBlock: '',
        stateLine: formatStateLine(metrics, scenario.world),
        optionText: sampleOptionText,
        effectsText: '',
        decisionRule: buildDecisionRule(ruleArgs),
        labels: scenario.labels,
      }),
    },
    scores,
    speaking: scores.flatMap(({ trait, line }) => line === null ? [] : [trait]),
    bar: decisionRuleNumbers(ruleArgs)?.bar ?? null,
    model: hostedDemo ? { provider: DEMO_PROVIDER, model: hostedRunModels().commander } : null,
  };
}
