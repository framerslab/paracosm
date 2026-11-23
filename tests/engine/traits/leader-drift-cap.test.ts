/**
 * A leader's trait moves at most 0.05 in a turn, however long the turn
 * (#248).
 *
 * The leader's drift capped the outcome pull at 0.05 and then multiplied
 * it by the turn's length, so on a Mars turn of eight years one safe
 * success added 0.16 to conscientiousness, agreeableness and
 * honesty-humility. In the three live Mars pairs of 8 and 10 November 2026
 * Aria Chen ("The Visionary") read conscientiousness 0.35, 0.37, 0.37,
 * 0.53, 0.69, 0.85 and 0.95 after turns 0 to 6, and both leaders stood at
 * 0.95 in all three traits by turn 6. The recorded outcome sequences are in
 * tests/fixtures/mars-live-decisions-2026-11.json.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { driftCommanderHexaco } from '../../../src/engine/core/progression.js';
import { driftLeaderProfile } from '../../../src/engine/traits/drift.js';
import { hexacoModel } from '../../../src/engine/traits/hexaco.js';
import { hexacoToTraits } from '../../../src/engine/traits/normalize-leader.js';
import { HEXACO_TRAITS, type HexacoProfile, type TurnOutcome } from '../../../src/engine/core/state.js';

interface RecordedRun {
  pairStartedAt: string;
  leader: string;
  hexacoHistory: Array<{ turn: number; hexaco: HexacoProfile }>;
  decisions: Array<{ turn: number; time: number; eventIndex: number; outcome: TurnOutcome }>;
}
const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/mars-live-decisions-2026-11.json', import.meta.url), 'utf-8'),
) as { runs: RecordedRun[] };

const OUTCOMES: TurnOutcome[] = ['risky_success', 'risky_failure', 'conservative_success', 'conservative_failure'];
/** Mars turns: the landing in 2035 counts as one year, then eight years a turn. */
const MARS_TURN_YEARS = 8;

const aria = (): HexacoProfile => ({ ...fixture.runs.find(r => r.leader === 'Aria Chen')!.hexacoHistory[0].hexaco });
const history = (): Array<{ turn: number; time: number; hexaco: HexacoProfile }> => [];
const largestMove = (a: HexacoProfile, b: HexacoProfile) => Math.max(...HEXACO_TRAITS.map(t => Math.abs(a[t] - b[t])));

describe('the leader\'s drift on a Mars turn', () => {
  it('one safe success on a turn of eight years moves conscientiousness by at most 0.05', () => {
    const before = aria();
    const after = { ...before };
    driftCommanderHexaco(after, 'conservative_success', MARS_TURN_YEARS, 2, 2043, history());
    const moved = after.conscientiousness - before.conscientiousness;
    assert.ok(moved <= 0.05 + 1e-9, `conscientiousness moved ${moved.toFixed(3)} in one turn`);
    assert.ok(moved > 0, 'a safe success still moves it');
  });

  it('on each of the six recorded outcome sequences no trait moves more than 0.05 between two turns', () => {
    assert.equal(fixture.runs.length, 6);
    for (const run of fixture.runs) {
      const live: HexacoProfile = { ...run.hexacoHistory[0].hexaco };
      const trail = history();
      const turns = [...new Set(run.decisions.map(d => d.turn))].sort((a, b) => a - b);
      for (const turn of turns) {
        const events = run.decisions.filter(d => d.turn === turn).sort((a, b) => a.eventIndex - b.eventIndex);
        const before = { ...live };
        driftCommanderHexaco(live, events[events.length - 1].outcome, turn === 1 ? 1 : MARS_TURN_YEARS, turn, events[0].time, trail);
        const moved = largestMove(before, live);
        assert.ok(moved <= 0.05 + 1e-9, `${run.leader}, pair of ${run.pairStartedAt}, turn ${turn}: a trait moved ${moved.toFixed(3)}`);
      }
      if (run.leader === 'Aria Chen') {
        assert.ok(live.conscientiousness <= 0.62, `${run.leader}, pair of ${run.pairStartedAt}: conscientiousness ${live.conscientiousness.toFixed(3)} after turn 6`);
      }
    }
  });

  it('the trait-model drift moves a HEXACO leader as the HEXACO drift does on a Mars turn, by at most 0.05', () => {
    for (const outcome of OUTCOMES) {
      const legacy = aria();
      driftCommanderHexaco(legacy, outcome, MARS_TURN_YEARS, 2, 2043, history());
      const drifted = driftLeaderProfile({ modelId: 'hexaco', traits: hexacoToTraits(aria(), hexacoModel) }, hexacoModel, {
        outcome,
        timeDelta: MARS_TURN_YEARS,
        turn: 2,
        time: 2043,
        history: [],
      });
      const start = aria();
      for (const trait of HEXACO_TRAITS) {
        assert.ok(Math.abs(drifted.traits[trait] - legacy[trait]) < 1e-9, `${outcome}, ${trait}: ${drifted.traits[trait]} against ${legacy[trait]}`);
        assert.ok(Math.abs(drifted.traits[trait] - start[trait]) <= 0.05 + 1e-9, `${outcome}, ${trait} moved ${(drifted.traits[trait] - start[trait]).toFixed(3)}`);
      }
    }
  });
});
