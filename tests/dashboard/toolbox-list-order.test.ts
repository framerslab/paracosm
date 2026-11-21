/**
 * The order of the forged toolbox's flat list (Group: None) on the 300-actor
 * run: 3,612 lines, every one a row, each actor's rows in launch order and
 * each actor's tools in the order they first appear in its own stream.
 *
 * The order expected here is read from the run's frames with this file's own
 * code, so the list cannot agree with itself. The browser tests read a whole
 * list through at 24 actors and the first and last rows at 300; this test
 * holds every line of the 300-actor list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRows, groupRows, listLines } from '../../src/dashboard/src/components/forge/ToolboxList.js';
import { buildToolRegistry } from '../../src/dashboard/src/hooks/toolRegistry.helpers.js';
import { computeGameState } from '../../src/dashboard/src/hooks/useGameState.js';
import { framesToSimEvents } from '../../tests-e2e/support/run-frames.js';
import { MAXIMUM, generateCohortRun } from '../../tests-e2e/support/forge-fixtures.js';

interface ParsedFrame {
  event: string;
  data: Record<string, unknown>;
}

function parseFrame(sse: string): ParsedFrame {
  const match = /^event: (\S+)\ndata: (.*)\n\n$/s.exec(sse);
  assert.ok(match, `not a stream frame: ${sse.slice(0, 80)}`);
  return { event: match[1], data: JSON.parse(match[2]) as Record<string, unknown> };
}

/**
 * Each actor's tools as the stream first names them: the actors in launch
 * order (the `parallel` status frame's list), and for each the names its
 * forge frames and its reports' tools hold, in the order each first appears.
 */
function toolsInStreamOrder(frames: string[]): Array<{ name: string; actor: string }> {
  const parsed = frames.map(parseFrame);
  const parallel = parsed.find((f) => f.event === 'status' && f.data.phase === 'parallel');
  assert.ok(parallel, 'the run has no parallel status frame');
  const roster = (parallel.data.actors as Array<{ name: string }>).map((a) => a.name);
  const toolsOf = new Map<string, string[]>(roster.map((name) => [name, []]));
  const note = (leader: string, tool: string) => {
    const own = toolsOf.get(leader);
    assert.ok(own, `a frame names an actor the run did not launch: ${leader}`);
    if (!own.includes(tool)) own.push(tool);
  };
  for (const f of parsed) {
    if (f.event !== 'sim') continue;
    const { type, leader, data } = f.data as { type: string; leader: string; data: Record<string, unknown> };
    if (type === 'forge_attempt') note(leader, String(data.name));
    if (type === 'specialist_done' && Array.isArray(data.forgedTools)) {
      for (const t of data.forgedTools as Array<{ name: string }>) note(leader, t.name);
    }
  }
  return roster.flatMap((name, i) => toolsOf.get(name)!.map((tool) => ({ name: tool, actor: `A${i + 1}` })));
}

test('the 300-actor run\'s flat list holds its 3,612 rows in the run\'s order, each at its own place', () => {
  const frames = generateCohortRun(MAXIMUM);
  const expected = toolsInStreamOrder(frames);
  assert.equal(expected.length, 3612);

  const registry = buildToolRegistry(computeGameState(framesToSimEvents(frames), true));
  // The list as the toolbox builds it under Group: None, with no filter, search or choice of actors.
  const rows = filterRows(registry.list, 'all', '');
  const { lines, rowCount } = listLines('none', rows, groupRows(rows, 'none', registry.actors), () => true);

  assert.equal(rowCount, 3612);
  assert.equal(lines.length, 3612);
  const shown = lines.map((line) => (line.kind === 'row'
    ? { kind: line.kind, pos: line.pos, name: line.entry.name, actor: `A${line.entry.actorIndex + 1}` }
    : { kind: line.kind, pos: 0, name: '', actor: '' }));
  assert.deepEqual(shown, expected.map((row, i) => ({ kind: 'row', pos: i + 1, ...row })));
  // Each line's key is its own, since a line's measured height is kept by it.
  assert.equal(new Set(lines.map((line) => line.key)).size, 3612);
});
