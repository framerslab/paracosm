import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunArtifact } from '../../src/engine/schema/index.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { recordHookSources } from '../../src/engine/compiler/hook-sources.js';
import type { CreateMarsServerOptions } from '../../src/server/server-app.js';
import type { ValidatedObjectOptions } from '../../src/llm/generateValidatedObject.js';
import { createMarsServer } from '../../src/server/server-app.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import { pairRunFrames, DEPARTMENTS } from './pair-run.js';
import { crewOf, framesToSimEvents, leaderTurn, systemsSnapshot } from './run-frames.js';

const appDir = mkdtempSync(join(tmpdir(), 'paracosm-marks-'));
const runsDir = join(appDir, 'runs');
mkdirSync(runsDir);
const savedArtifact: RunArtifact = JSON.parse(readFileSync(new URL('../../tests/fixtures/runArtifact-v0.8-turn-loop.json', import.meta.url), 'utf8'));
const knownFrames = framesToSimEvents(pairRunFrames()).filter(frame => frame.type !== 'status');
const completedAt = '2026-11-23T00:01:00.000Z';

const instructions = 'Check the water stores before each harvest.';
const hexaco = { honestyHumility: 0.5, emotionality: 0.5, extraversion: 0.5, agreeableness: 0.5, conscientiousness: 0.5, openness: 0.5 };
const run: NonNullable<CreateMarsServerOptions['runPairSimulations']> = async (config, broadcast, _signal, _scenario, onArtifact) => {
    broadcast('status', { phase: 'parallel', maxTurns: config.turns, actors: config.actors });
    for (const [side, actor] of config.actors.entries()) {
      const fixtureName = side === 0 ? 'Aria Chen' : 'Dietrich Voss';
      const frames = (config.actors.length > 2 && side > 1 ? [] : knownFrames).filter(frame => frame.leader === fixtureName && Number(frame.data.turn) <= config.turns);
      for (let turn = 3; turn <= config.turns && (side < 2 || config.actors.length === 2); turn++) {
        frames.push(...framesToSimEvents([
          ...leaderTurn(actor.name, turn, 'engineering', [], []),
          systemsSnapshot(actor.name, turn, 2035 + (turn - 1) * 8, crewOf(actor.name, turn, DEPARTMENTS)),
        ]));
      }
      for (const frame of frames) {
        const data = { ...frame.data };
        if (frame.type === 'decision_made') {
          data.decision = side === 0 ? 'Keep a reserve of water.' : 'Spend the reserve on new wells.';
          data.rationale = side === 0 ? 'The next harvest needs a cushion.' : 'The crew needs a reliable well.';
          data.reasoning = '';
          data.aiWrittenFields = ['decision', 'rationale'];
        } else if (frame.type === 'specialist_done' && data.department === 'engineering') {
          data.summary = 'Pressure held overnight.';
          data.aiWrittenFields = side === 0 ? ['summary'] : [];
        }
        broadcast('sim', { ...frame, data, leader: actor.name }, actor.name);
      }
      const [agent] = crewOf(actor.name, 1, DEPARTMENTS, 1);
      broadcast('sim', { type: 'agent_reactions', leader: actor.name, data: {
        turn: 1, time: 2035, reactions: [{ ...agent, quote: 'The crew inspected the wells.' }],
      } }, actor.name);
      let artifact: RunArtifact | undefined;
      if (config.actors[0].name === 'Report leader') {
        const runId = 'marks-' + randomUUID();
        const outputPath = join(runsDir, runId + '.json');
        artifact = {
          ...savedArtifact,
          metadata: { ...savedArtifact.metadata, runId },
          provenance: { aiGenerated: true, generator: 'paracosm', models: { commander: side === 0 ? 'test-commander-a' : 'test-commander-b' } },
          decisions: [{ ...savedArtifact.decisions[0], actor: actor.name, choice: 'Keep a reserve of water.', aiWrittenFields: ['choice'] }],
          scenarioExtensions: { ...savedArtifact.scenarioExtensions, outputPath, paracosmInternal: { leader: actor } },
        };
        writeFileSync(outputPath, JSON.stringify(artifact));
        await onArtifact?.(artifact, actor);
      }
      broadcast('result', { leader: actor.name, summary: { population: 30, morale: 0.87 }, artifact }, actor.name);
    }
    if (config.actors.length > 2) broadcast('cohort_verdict', {
      winnerIndex: 0,
      actors: config.actors,
      headline: 'Water reserves separated the cohort.',
      summary: 'The leaders retained different reserves.',
      rankings: config.actors.map((actor, index) => ({ actorName: actor.name, actorIndex: index, rank: index + 1, rationale: 'Recorded reserve at the last turn.' })),
      verdictModel: 'test-verdict',
    });
    else broadcast('verdict', {
      winner: 'A', winnerName: config.actors[0].name,
      leaderA: config.actors[0], leaderB: config.actors[1],
      headline: 'The reserve carried the crew.',
      summary: 'Stored water protected the new crops.',
      keyDivergence: 'One leader kept more water available.',
      ...(config.actors[0].name === 'Report leader' ? { verdictModel: 'test-verdict' } : {}),
      scores: { a: {}, b: {} },
      finalStats: { a: {}, b: {}, metrics: [] },
    });
    broadcast('complete', { timestamp: completedAt });
};

const server = createMarsServer({
  generateActorObject: (async ({ prompt }: { prompt: string }) => {
    const count = Number(prompt.match(/Generate exactly (\d+)/)?.[1] ?? 2);
    const names = count === 2 ? ['Generated leader', 'Supplied leader'] :
      Array.from({ length: count }, (_, index) => 'Generated leader ' + (index + 1));
    const object = { actors: names.map(name => ({ name, archetype: 'Engineer', unit: 'Water', instructions, hexaco })) };
    return { object, text: JSON.stringify(object), model: 'test-leader-writer', usage: {} };
  }) as ValidatedObjectOptions<any>['_generateObjectImpl'],
  compileScenario: async json => {
    const hooks = { ...marsScenario.hooks };
    recordHookSources(hooks, { schemaVersion: 1, model: 'test-compiler', hooks: { progression: 'fixture progression' } });
    return { ...marsScenario, id: String(json.id), hooks };
  },
  chatAgent: (async () => ({
    session: { send: async () => ({ text: 'The water stores are stable.' }) },
    isNew: true,
    model: 'test-chat',
  })) as NonNullable<CreateMarsServerOptions['chatAgent']>,
  env: { ...process.env, APP_DIR: appDir, PARACOSM_OUTPUT_DIR: runsDir, PARACOSM_HOSTED_DEMO: '' },
  maxSimsPerDay: 0,
  runHistoryStore: createSqliteRunHistoryStore({ dbPath: join(appDir, 'history.db') }),
  getDigitalTwinWorld: async () => null,
  runPairSimulations: run,
  runBatchSimulations: (config, broadcast, signal, scenario, onArtifact) =>
    run(config, broadcast, signal, scenario, onArtifact),
});
server.listen(Number(process.env.PORT ?? 3474));
