/**
 * An approved forge stays one of the run's tools when its department's
 * report fails.
 *
 * A department's forge_tool calls are captured while its session runs, and
 * the department step writes the tool ledger only after the report parses.
 * When the department's next model call throws (a transient provider error),
 * the step returns the empty report and writes nothing, though the engine
 * holds the approved tool. These tests hold the ledger as the department
 * step leaves it, hand the event's captured forges to the function the turn
 * loop takes them into the run with, and read the toolbox, the tool count
 * and the ALREADY-FORGED TOOLS block from it. The departments are Atlas Lab's
 * from scenarios/. No model call: runSimulation has no seam for one, and
 * the ledger and the captured forges are all these read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import {
  buildAvailableToolsBlock,
  buildForgedToolbox,
  forgedToolNames,
  recordEventForges,
  type CapturedForgeForLedger,
  type ForgedLedger,
  type ForgeEvent,
} from '../../src/runtime/orchestrator/tool-ledger.js';

const here = dirname(fileURLToPath(import.meta.url));
const atlasLab = loadDiskCustomScenarios(resolve(here, '../../scenarios')).get('atlas-lab')?.scenario as ScenarioPackage | undefined;
assert.ok(atlasLab, 'scenarios/ holds atlas-lab');
const departments = atlasLab.departments.map(d => d.id);
const governance = departments.find(id => id === 'governance');
const alignment = departments.find(id => id === 'alignment_research');
assert.ok(governance && alignment, 'Atlas Lab has governance and alignment_research');

type Captured = CapturedForgeForLedger & { timestamp: number };
type RunForge = Captured & { turn: number; time: number; eventIndex: number };

function capture(name: string, department: string, approved: boolean): Captured {
  return {
    name,
    description: `${name} for the release review`,
    mode: 'sandbox',
    approved,
    confidence: approved ? 0.88 : 0,
    department,
    inputSchema: { type: 'object', properties: { incidents: { type: 'number' } } },
    outputSchema: { type: 'object', properties: { risk: { type: 'number' } } },
    output: approved ? '{"risk":0.42}' : null,
    timestamp: 1,
  };
}

/** The ledger entry the department step writes for a forge once its report parses. */
function reportWrote(ledger: ForgedLedger, forge: Captured, event: ForgeEvent): void {
  const entry = ledger.get(forge.name) ?? {
    firstForgedTurn: event.turn,
    firstForgedDepartment: forge.department,
    firstForgedEventIndex: event.eventIndex,
    firstForgedEventTitle: event.eventTitle,
    inputSchema: forge.inputSchema,
    outputSchema: forge.outputSchema,
    history: [],
  };
  ledger.set(forge.name, entry);
  entry.history.push({
    turn: event.turn, time: event.time, eventIndex: event.eventIndex, eventTitle: event.eventTitle,
    department: forge.department, output: forge.output as string | null, isReforge: true, rejected: !forge.approved, confidence: forge.confidence,
  });
}

const turnOne: ForgeEvent = { turn: 1, time: 1, eventIndex: 0, eventTitle: 'Refusal regression' };
const turnTwo: ForgeEvent = { turn: 2, time: 2, eventIndex: 1, eventTitle: 'Release review' };

test('an approved forge whose department\'s report failed is in the toolbox once, as its first forge', () => {
  const ledger: ForgedLedger = new Map();
  const allForges: RunForge[] = [];
  // Governance forges incident_risk and the reviewers approve it; its next
  // model call fails, so its report is the empty one and writes no ledger.
  const forge = capture('incident_risk', governance, true);
  recordEventForges([forge], turnOne, ledger, allForges);

  assert.deepEqual(forgedToolNames(ledger, allForges), ['incident_risk']);
  const [tool] = buildForgedToolbox(ledger, allForges);
  assert.equal(tool.approved, true);
  assert.equal(tool.firstForgedTurn, 1);
  assert.equal(tool.firstForgedDepartment, governance);
  assert.equal(tool.firstForgedEventTitle, 'Refusal regression');
  assert.equal(tool.totalUses, 1);
  assert.equal(tool.confidence, 0.88);
  // The next event's departments are told the tool exists.
  assert.match(buildAvailableToolsBlock(ledger), /- incident_risk \(governance\): Refusal regression/);
});

test('a forge the department\'s report recorded is not recorded again', () => {
  const ledger: ForgedLedger = new Map();
  const allForges: RunForge[] = [];
  // Alignment's report parses and records its forge; governance's fails
  // after forging a second tool.
  const recorded = capture('eval_gap', alignment, true);
  reportWrote(ledger, recorded, turnOne);
  const lost = capture('incident_risk', governance, true);
  recordEventForges([recorded, lost], turnOne, ledger, allForges);

  assert.deepEqual([...forgedToolNames(ledger, allForges)].sort(), ['eval_gap', 'incident_risk']);
  assert.equal(ledger.get('eval_gap')!.history.length, 1, 'the report\'s record stands alone');
  assert.equal(ledger.get('incident_risk')!.history.length, 1);
  assert.equal(allForges.length, 2);
});

test('an approved re-forge whose report failed makes a tool rejected before a tool of the run', () => {
  const ledger: ForgedLedger = new Map();
  const allForges: RunForge[] = [];
  // Turn 1: governance's forge is rejected, and its report records it.
  const rejected = capture('incident_risk', governance, false);
  reportWrote(ledger, rejected, turnOne);
  recordEventForges([rejected], turnOne, ledger, allForges);
  assert.deepEqual(forgedToolNames(ledger, allForges), []);

  // Turn 2: alignment forges it again, approved, and its report fails.
  recordEventForges([capture('incident_risk', alignment, true)], turnTwo, ledger, allForges);
  assert.deepEqual(forgedToolNames(ledger, allForges), ['incident_risk']);
  const entry = ledger.get('incident_risk')!;
  assert.equal(entry.firstForgedTurn, 1, 'the first forge stays the rejected one');
  assert.equal(entry.history.length, 2);
  assert.match(buildAvailableToolsBlock(ledger), /incident_risk/);
});

test('a rejected forge whose report failed is still no tool of the run', () => {
  const ledger: ForgedLedger = new Map();
  const allForges: RunForge[] = [];
  recordEventForges([capture('incident_risk', governance, false)], turnOne, ledger, allForges);
  assert.deepEqual(forgedToolNames(ledger, allForges), []);
  assert.equal(buildAvailableToolsBlock(ledger), '');
});

test('an approval stays when the report recorded a later rejected forge of the same tool', () => {
  const ledger: ForgedLedger = new Map();
  const allForges: RunForge[] = [];
  // Governance forges incident_risk, approved, then forges it again and the
  // reviewers reject that one. Its report parses and records the tool once,
  // from the last capture: rejected. The engine holds the approved tool.
  const approved = capture('incident_risk', governance, true);
  const rejected = capture('incident_risk', governance, false);
  reportWrote(ledger, rejected, turnOne);
  recordEventForges([approved, rejected], turnOne, ledger, allForges);

  assert.deepEqual(forgedToolNames(ledger, allForges), ['incident_risk']);
  const [tool] = buildForgedToolbox(ledger, allForges);
  assert.equal(tool.approved, true);
  assert.equal(tool.firstForgedDepartment, governance);
  assert.match(buildAvailableToolsBlock(ledger), /incident_risk/);
});

test('two approved forges of one tool by one department before its report failed leave the later one, as a report would', () => {
  const ledger: ForgedLedger = new Map();
  const allForges: RunForge[] = [];
  // Governance forges incident_risk, approved, then forges it again with a
  // further input, approved too, and its next model call fails. A report
  // records a tool once per event, from its last capture, so the recorded
  // forge is the later one: its output, confidence and schemas.
  const first = capture('incident_risk', governance, true);
  const later: Captured = {
    ...capture('incident_risk', governance, true),
    confidence: 0.93,
    output: '{"risk":0.61}',
    inputSchema: { type: 'object', properties: { incidents: { type: 'number' }, severity: { type: 'number' } } },
  };
  recordEventForges([first, later], turnOne, ledger, allForges);

  const entry = ledger.get('incident_risk')!;
  assert.equal(entry.history.length, 1, 'one record for the tool, its department and the event');
  assert.equal(entry.history[0].output, '{"risk":0.61}');
  assert.equal(entry.history[0].confidence, 0.93);
  assert.deepEqual(entry.inputSchema, later.inputSchema);
  assert.match(buildAvailableToolsBlock(ledger), /last output: \{"risk":0\.61\}/);
  assert.equal(allForges.length, 2, 'the run keeps both attempts');
});
