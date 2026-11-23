import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import { pairRunFrames, DEPARTMENTS } from './pair-run.js';
import { crewOf, framesToSimEvents, leaderTurn, systemsSnapshot } from './run-frames.js';

const appDir = mkdtempSync(join(tmpdir(), 'paracosm-marks-'));
const knownFrames = framesToSimEvents(pairRunFrames()).filter(frame => frame.type !== 'status');
const completedAt = '2026-11-23T00:01:00.000Z';

const server = createMarsServer({
  env: { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: '' },
  maxSimsPerDay: 0,
  runHistoryStore: createSqliteRunHistoryStore({ dbPath: join(appDir, 'history.db') }),
  getDigitalTwinWorld: async () => null,
  runPairSimulations: async (config, broadcast) => {
    broadcast('status', { phase: 'parallel', maxTurns: config.turns, actors: config.actors });
    for (const [side, actor] of config.actors.entries()) {
      const fixtureName = side === 0 ? 'Aria Chen' : 'Dietrich Voss';
      const frames = knownFrames.filter(frame => frame.leader === fixtureName && Number(frame.data.turn) <= config.turns);
      for (let turn = 3; turn <= config.turns; turn++) {
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
      broadcast('result', { leader: actor.name, summary: { population: 30, morale: 0.87 } }, actor.name);
    }
    broadcast('verdict', {
      winner: 'A', winnerName: config.actors[0].name,
      leaderA: config.actors[0], leaderB: config.actors[1],
      headline: 'The reserve carried the crew.',
      summary: 'Stored water protected the new crops.',
      keyDivergence: 'One leader kept more water available.',
      scores: { a: {}, b: {} },
      finalStats: { a: {}, b: {}, metrics: [] },
    });
    broadcast('complete', { timestamp: completedAt });
  },
});
server.listen(Number(process.env.PORT ?? 3474));
