/**
 * The stream's tool count is the run's tools, not their uses.
 *
 * In the live Atlas Lab pair of 3 November 2026 Priya Kapoor's run forged 7
 * tools and Marcus Reinhardt's 18, and their last turn_done events said 28 and
 * 27: the orchestrator counted its per-department registries, which hold a
 * tool's name once for every use. The director's "Tools forged so far" read the
 * same list. The verdict counts each approved tool once since #171.
 *
 * These tests rebuild each run's tool ledger turn by turn from the run's own
 * toolbox and forge attempts, and hand it to the function the orchestrator
 * counts with for turn_done, sim_aborted and the director's prompt. No model
 * call: runSimulation has no seam for one, and the ledger is all the count
 * reads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgedToolNames, type ForgedLedger, type ForgeCaptureForToolbox, type ToolUseRecord } from '../../src/runtime/orchestrator/tool-ledger.js';

const here = dirname(fileURLToPath(import.meta.url));

interface CapturedTool {
  name: string;
  firstForgedTurn: number;
  firstForgedDepartment: string;
  firstForgedEventTitle: string;
  approved: boolean;
  history: Array<Omit<ToolUseRecord, 'eventTitle' | 'output'>>;
}

interface CapturedRun {
  leaderName: string;
  streamTurnDone: Array<{ turn: number; toolsForged: number }>;
  forgedTools: CapturedTool[];
  forgeAttempts: Array<{ name: string; mode: string; approved: boolean; confidence: number; turn: number }>;
  toolRegistries: Record<string, string[]>;
}

const livePair = JSON.parse(
  readFileSync(resolve(here, '../fixtures/stream/atlas-lab-pair-2026-11-03.json'), 'utf-8'),
) as { runs: CapturedRun[] };

/** The ledger and the forge attempts as the orchestrator held them when turn `turn` ended. */
function throughTurn(run: CapturedRun, turn: number): { ledger: ForgedLedger; forges: ForgeCaptureForToolbox[] } {
  const ledger: ForgedLedger = new Map();
  for (const tool of run.forgedTools) {
    const history = tool.history.filter(h => h.turn <= turn).map(h => ({ ...h, eventTitle: '', output: null }));
    if (history.length === 0) continue;
    ledger.set(tool.name, {
      firstForgedTurn: tool.firstForgedTurn,
      firstForgedDepartment: tool.firstForgedDepartment,
      firstForgedEventIndex: history[0].eventIndex,
      firstForgedEventTitle: tool.firstForgedEventTitle,
      history,
    });
  }
  const forges = run.forgeAttempts
    .filter(f => f.turn <= turn)
    .map(f => ({ name: f.name, description: f.name, mode: f.mode, approved: f.approved, confidence: f.confidence }));
  return { ledger, forges };
}

test('each turn_done counts the tools forged so far, once each, however often they were used', () => {
  const expected = [
    { leaderName: 'Priya Kapoor', tools: 7, streamed: 28 },
    { leaderName: 'Marcus Reinhardt', tools: 18, streamed: 27 },
  ];
  livePair.runs.forEach((run, i) => {
    assert.equal(run.leaderName, expected[i].leaderName);
    const uses = Object.values(run.toolRegistries).flat().length;
    const last = run.streamTurnDone[run.streamTurnDone.length - 1];
    // What the live stream said: every use of every tool.
    assert.equal(last.toolsForged, expected[i].streamed);
    assert.equal(last.toolsForged, uses);

    for (const { turn } of run.streamTurnDone) {
      const { ledger, forges } = throughTurn(run, turn);
      const names = forgedToolNames(ledger, forges);
      const firstForgedBy = run.forgedTools.filter(t => t.firstForgedTurn <= turn && t.approved).map(t => t.name);
      assert.deepEqual([...names].sort(), [...firstForgedBy].sort(), `${run.leaderName}, turn ${turn}`);
      assert.equal(new Set(names).size, names.length, 'a tool is named once');
    }

    // At the end the stream's count is the artifact's, as the verdict reads it.
    const { ledger, forges } = throughTurn(run, last.turn);
    assert.equal(forgedToolNames(ledger, forges).length, expected[i].tools);
    assert.equal(forgedToolNames(ledger, forges).length, run.forgedTools.filter(t => t.approved !== false).length);
  });
});

test('a forge attempt the reviewers rejected is no tool of the run', () => {
  const run = livePair.runs[0];
  const { ledger, forges } = throughTurn(run, 6);
  ledger.set('rejected_release_gate', {
    firstForgedTurn: 6,
    firstForgedDepartment: 'governance',
    firstForgedEventIndex: 0,
    firstForgedEventTitle: 'Refusal regression',
    history: [{ turn: 6, time: 6, eventIndex: 0, eventTitle: 'Refusal regression', department: 'governance', output: null, isReforge: true, rejected: true }],
  });
  forges.push({ name: 'rejected_release_gate', description: '', mode: 'sandbox', approved: false, confidence: 0 });
  const names = forgedToolNames(ledger, forges);
  assert.equal(names.length, 7);
  assert.ok(!names.includes('rejected_release_gate'));
});
