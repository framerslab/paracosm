/**
 * A Mars Genesis run through the real turn loop with a stub model in place
 * of the provider.
 *
 * `runSimulation` reaches its model through AgentOS's OpenAI provider, which
 * sends every call with the global `fetch`. The stub answers that `fetch`
 * (the transport in stub-openai-transport.ts, which the seed compile's
 * helper shares) and nothing reaches a network: the model list, then each
 * chat call. The commander's two decisions get the replies Aria Chen wrote in the hosted
 * Mars Genesis pair of 11 November 2026 at 07:39 UTC (seed 950, 30 people,
 * three departments), recorded in
 * tests/fixtures/mars-live-decisions-2026-11.json under `ruleReplies`:
 * Landfall, where she took the canyon rim (option_b), and Legacy
 * Assessment, where she gave the honest report (option_a). Each reaction
 * batch gets one hopeful reaction at 0.9 for every person its prompt names,
 * so the reaction step writes each person's memory. Every other call (the
 * commander's first message, the promotions, the department reports) gets
 * `{}`, which fails its schema, so the run takes the fallback the code
 * keeps for a model that answers badly: the top candidate as head, the
 * empty report.
 *
 * Two turns: Mars plays its two milestones (turn 1 and the final turn), so
 * the run makes no Event Director call.
 */
import { readFileSync } from 'node:fs';
import { runSimulation } from '../../../src/runtime/orchestrator/index.js';
import { marsScenario } from '../../../src/engine/scenarios/index.js';
import type { RunArtifact } from '../../../src/engine/schema/index.js';
import { withStubOpenAi } from './stub-openai-transport.js';

/** The line only the commander's decision prompt carries (the options block). */
export const DECISION_PROMPT_MARK = 'You MUST include "selectedOptionId"';

interface RecordedRun {
  leader: string;
  decisions: Array<{ title: string; reply: Record<string, unknown> }>;
}

const recorded = JSON.parse(
  readFileSync(new URL('../../fixtures/mars-live-decisions-2026-11.json', import.meta.url), 'utf-8'),
) as { ruleReplies: { runs: RecordedRun[] } };
const aria = recorded.ruleReplies.runs.find(r => r.leader === 'Aria Chen');
if (!aria) throw new Error('the fixture holds Aria Chen\'s recorded replies');
/** Aria Chen's recorded reply for each event title. */
const REPLIES = new Map(aria.decisions.map(d => [d.title, d.reply]));

/** What the stub model saw and answered. */
export interface StubModelLog {
  /** Every URL the run fetched, in order. */
  urls: string[];
  /** The titles of the decision prompts it answered with a recorded reply, in order. */
  decisions: string[];
  /** The reactions it wrote, one for each person a reaction prompt named. */
  reactions: number;
}

/** Aria Chen's recorded reply to the decision prompt of the event with this title, if the fixture holds one. */
export function recordedAriaReply(title: string): Record<string, unknown> | undefined {
  return REPLIES.get(title);
}

/**
 * The title of the event a commander's decision prompt asks about, or null
 * for a prompt that is no decision prompt. The prompt opens "TURN 1, Year
 * 2035: Landfall".
 */
export function decisionTitleOf(prompt: string): string | null {
  if (!prompt.includes(DECISION_PROMPT_MARK)) return null;
  return /^TURN \d+[^:\n]*: (.+)$/m.exec(prompt)?.[1]?.trim() ?? '';
}

/**
 * The reply to a reaction batch: one hopeful reaction at 0.9 for each person
 * the prompt names, or null for a prompt that is no reaction batch. A
 * reaction batch names each person on a line of its own: "AGENT id=<id>".
 */
export function reactionReply(prompt: string): { reply: string; people: number } | null {
  const reactors = [...prompt.matchAll(/^AGENT id=(\S+)$/gm)].map(m => m[1]);
  if (reactors.length === 0) return null;
  return {
    people: reactors.length,
    reply: JSON.stringify({
      reactions: reactors.map(agentId => ({ agentId, quote: 'The rim held through the night.', mood: 'hopeful', intensity: 0.9 })),
    }),
  };
}

/**
 * The reply to one prompt: a recorded decision for the commander's decision
 * prompt, a reaction for each person a reaction prompt names, else `{}`.
 */
function replyTo(prompt: string, log: StubModelLog): string {
  const reaction = reactionReply(prompt);
  if (reaction) {
    log.reactions += reaction.people;
    return reaction.reply;
  }
  const title = decisionTitleOf(prompt);
  if (title === null) return '{}';
  const reply = REPLIES.get(title);
  if (!reply) return '{}';
  log.decisions.push(title);
  return JSON.stringify(reply);
}

/**
 * Run Mars Genesis for two turns with Aria Chen, the turn loop's snapshots
 * on, and the stub model. Returns the artifact the run saved and what the
 * stub answered. `onEvent` is handed each event the run emits, as a server
 * that streams the run is.
 */
export async function runMarsWithStubModel(options: { onEvent?: (event: unknown) => void } = {}): Promise<{ artifact: RunArtifact; log: StubModelLog }> {
  const log: StubModelLog = { urls: [], decisions: [], reactions: 0 };
  // The reply reads the last user message alone: every prompt of the turn loop sits there.
  const artifact = await withStubOpenAi(request => replyTo(request.lastUser, log), async (seen) => {
    try {
      const leader = marsScenario.presets[0].leaders[0];
      return await runSimulation({ ...leader, unit: 'Colony Alpha' } as never, [], {
        scenario: marsScenario,
        maxTurns: 2,
        seed: 950,
        initialPopulation: 30,
        activeDepartments: ['medical', 'engineering', 'agriculture'] as never,
        captureSnapshots: true,
        onEvent: options.onEvent,
        provider: 'openai',
        apiKey: 'placeholder-key-for-a-test',
        models: { commander: 'gpt-4o', departments: 'gpt-4o', judge: 'gpt-4o', director: 'gpt-4o', agentReactions: 'gpt-4o' },
      });
    } finally {
      log.urls.push(...seen.map(e => e.url));
    }
  });
  return { artifact, log };
}
