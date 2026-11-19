/**
 * The generated runs the forged tool view's tests replay: a run of 24 actors
 * and a run of 300, written from a seed in the stream's own frame shape with
 * no model call. These tests count the frames with their own code, so a
 * wrong generator cannot agree with itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOZENS,
  DOZENS_A7_UNREADABLE,
  MAXIMUM,
  generateCohortRun,
} from '../../tests-e2e/support/forge-fixtures.js';

interface ParsedFrame {
  event: string;
  data: Record<string, unknown>;
}

function parseFrame(sse: string): ParsedFrame {
  const match = /^event: (\S+)\ndata: (.*)\n\n$/s.exec(sse);
  assert.ok(match, `not a stream frame: ${sse.slice(0, 80)}`);
  return { event: match[1], data: JSON.parse(match[2]) as Record<string, unknown> };
}

interface SimFrame {
  type: string;
  leader: string;
  data: Record<string, unknown>;
}

const simFrames = (frames: string[]): SimFrame[] =>
  frames.map(parseFrame).filter((f) => f.event === 'sim').map((f) => f.data as unknown as SimFrame);

/** The actors the run launches, in order: the list of its `parallel` status frame. */
function roster(frames: string[]): string[] {
  const parallel = frames.map(parseFrame).find((f) => f.event === 'status' && f.data.phase === 'parallel');
  assert.ok(parallel, 'the run has no parallel status frame');
  return (parallel.data.actors as Array<{ name: string }>).map((a) => a.name);
}

function countFrames(frames: string[]) {
  const names = roster(frames);
  const sims = simFrames(frames);
  const forges = sims.filter((f) => f.type === 'forge_attempt');
  const reports = sims.filter((f) => f.type === 'specialist_done');

  // A tool is one actor's: a name it forged or one of its reports lists.
  const toolsOf = new Map<string, Set<string>>(names.map((n) => [n, new Set<string>()]));
  for (const f of forges) toolsOf.get(f.leader)?.add(String(f.data.name));
  for (const r of reports) {
    if (!Array.isArray(r.data.forgedTools)) continue;
    for (const t of r.data.forgedTools as Array<{ name: string }>) toolsOf.get(r.leader)?.add(t.name);
  }

  // The page keeps one frame of a report for an actor, turn, event and
  // department, and one forge frame for those and its tool's name and time.
  const repeats = (keys: string[]) => keys.length - new Set(keys).size;
  const reportKey = (f: SimFrame) => [f.leader, f.data.turn, f.data.eventIndex, f.data.department].join('|');

  return {
    actors: new Set(sims.map((f) => f.leader)).size,
    tools: [...toolsOf.values()].reduce((sum, set) => sum + set.size, 0),
    forges: forges.length,
    passed: forges.filter((f) => f.data.approved === true).length,
    toolsByActor: names.map((n) => toolsOf.get(n)!.size),
    actorsForging: (tool: string) => new Set(forges.filter((f) => f.data.name === tool).map((f) => f.leader)).size,
    /** Tools of one actor forged more than once, whose first forge did not pass. */
    reforgedTools: (actor: number) => {
      const attempts = new Map<string, boolean[]>();
      for (const f of forges) {
        if (f.leader !== names[actor]) continue;
        const name = String(f.data.name);
        attempts.set(name, [...(attempts.get(name) ?? []), f.data.approved === true]);
      }
      return [...attempts.values()].filter((a) => a.length > 1 && a[0] === false).length;
    },
    repeatedReports: repeats(reports.map(reportKey)),
    repeatedForges: repeats(forges.map((f) => [reportKey(f), f.data.name, f.data.timestamp].join('|'))),
    forgesWithNoReason: forges.filter((f) => f.data.approved !== true && typeof f.data.errorReason !== 'string').length,
  };
}

test('the dozens run holds 24 actors, 286 tools from 331 forges, 268 passed', () => {
  const c = countFrames(generateCohortRun(DOZENS));
  assert.deepEqual([c.actors, c.tools, c.forges, c.forges - c.tools, c.passed, c.forges - c.passed], [24, 286, 331, 45, 268, 63]);
  assert.ok(c.toolsByActor.every((n) => n <= 50));
  assert.equal(c.actorsForging(DOZENS.sharedName!.name), 3);
  assert.ok(c.reforgedTools(0) >= 1);                    // A1 holds a tool forged twice
  assert.deepEqual([c.repeatedReports, c.repeatedForges, c.forgesWithNoReason], [0, 0, 0]);
});

test('the maximum run holds 300 actors, 3,612 tools from 4,207 forges, 3,301 passed', () => {
  const c = countFrames(generateCohortRun(MAXIMUM));
  assert.deepEqual([c.actors, c.tools, c.forges, c.forges - c.tools, c.passed], [300, 3612, 4207, 595, 3301]);
  assert.equal(c.toolsByActor[298], 50);                 // A299
  assert.ok(c.toolsByActor.every((n) => n <= 50));
  assert.equal(c.actorsForging(MAXIMUM.sharedName!.name), 40);
  assert.ok(c.reforgedTools(298) >= 1);                  // A299 holds a tool forged twice
  assert.deepEqual([c.repeatedReports, c.repeatedForges, c.forgesWithNoReason], [0, 0, 0]);
});

test('a seed gives the same frames twice', () => {
  assert.deepEqual(generateCohortRun(DOZENS), generateCohortRun(DOZENS));
});

test('the A7-unreadable run differs from the dozens run only in A7 reports', () => {
  const whole = generateCohortRun(DOZENS);
  const unreadable = generateCohortRun(DOZENS_A7_UNREADABLE);
  const a7 = roster(whole)[6];
  assert.equal(unreadable.length, whole.length);

  let a7Reports = 0;
  for (let i = 0; i < whole.length; i++) {
    const before = parseFrame(whole[i]);
    const sim = before.data as unknown as SimFrame;
    const isA7Report = before.event === 'sim' && sim.type === 'specialist_done' && sim.leader === a7;
    if (!isA7Report) {
      assert.equal(unreadable[i], whole[i], `frame ${i} is not a report of A7 and differs`);
      continue;
    }
    a7Reports++;
    const after = parseFrame(unreadable[i]).data as unknown as SimFrame;
    // The report as sent, but for its tools: a string where the list belongs.
    assert.equal(typeof after.data.forgedTools, 'string');
    assert.deepEqual({ ...after, data: { ...after.data, forgedTools: null } }, { ...sim, data: { ...sim.data, forgedTools: null } });
  }
  assert.ok(a7Reports >= 1);
});

test('actors first appear in launch order', () => {
  for (const spec of [DOZENS, MAXIMUM]) {
    const frames = generateCohortRun(spec);
    const names = roster(frames);
    assert.equal(names.length, spec.actors);
    assert.equal(new Set(names).size, spec.actors);
    // The first frame of A(n) comes before A(n+1)'s, so the page lists the actors in launch order.
    const sims = simFrames(frames);
    const firstFrame = names.map((n) => sims.findIndex((f) => f.leader === n));
    assert.ok(firstFrame.every((at) => at >= 0), 'an actor of the roster has no frame');
    assert.deepEqual(firstFrame, [...firstFrame].sort((a, b) => a - b));
  }
});
