/**
 * What the forged tool view spec shares between its tests: the two servers
 * that store its runs, the widths and looks it walks, how it finds a stored
 * run and opens its replay, and how it reads the toolbox's list, which past
 * 50 lines renders only the lines in view.
 */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/** The stored pair run: tests-e2e/support/shared-run-server.ts. */
export const PAIR_SERVER = 'http://127.0.0.1:3462';
/** The generated runs of 24 and 300 actors: tests-e2e/support/cohort-run-server.ts. */
export const COHORT_SERVER = 'http://127.0.0.1:3467';
/** Where the spec saves its pictures, which CI uploads. */
export const PICTURES = 'test-pictures/forged-tool-view';

/** A phone and a desktop. */
export const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;
/** The widths a row of keys is checked at. */
export const SWEEP_WIDTHS = [320, 360, 390, 430, 480, 768] as const;
export const LOOKS = ['light', 'dark'] as const;
export type Look = (typeof LOOKS)[number];

/** The names the cohort server stores its runs under. */
export const RUNS = {
  dozens: 'Mars Genesis · 24 actors',
  maximum: 'Mars Genesis · 300 actors',
  dozensA7Unreadable: 'Mars Genesis · 24 actors, A7 unreadable',
  reportOnlyPair: 'Mars Genesis · report-only pair',
  noForgePair: 'Mars Genesis · no forge',
} as const;

/** How many times useLook has been called in this worker: each call's number orders its script. */
let lookCalls = 0;

/** Opens every page of the test in one look. */
export async function useLook(page: Page, look: Look): Promise<void> {
  // Each call adds a script the page runs before its own on every load, and
  // Playwright runs a page's scripts in no set order: the latest call's
  // number is the highest, so its look is the one the page keeps.
  lookCalls += 1;
  await page.addInitScript(({ t, n }) => {
    const w = window as unknown as { __lookCall?: number };
    if ((w.__lookCall ?? 0) > n) return;
    w.__lookCall = n;
    window.localStorage.setItem('paracosm-theme', t);
  }, { t: look, n: lookCalls });
}

interface StoredSession { id: string; scenarioName?: string }

async function storedSessions(request: APIRequestContext, server: string): Promise<StoredSession[]> {
  const res = await request.get(`${server}/sessions`);
  expect(res.ok()).toBe(true);
  return (await res.json() as { sessions: StoredSession[] }).sessions;
}

/** The id of the one run a server stores under a scenario name, from its own GET /sessions. */
export async function sessionIdByName(request: APIRequestContext, server: string, scenarioName: string): Promise<string> {
  const found = (await storedSessions(request, server)).filter(s => s.scenarioName === scenarioName);
  expect(found, `one stored run named "${scenarioName}"`).toHaveLength(1);
  return found[0].id;
}

/** The id of the pair run, the one session its server stores. */
export async function pairSessionId(request: APIRequestContext): Promise<string> {
  const sessions = await storedSessions(request, PAIR_SERVER);
  expect(sessions).toHaveLength(1);
  return sessions[0].id;
}

/** The address that replays a stored run on one tab of the dashboard. */
export const replayUrl = (server: string, id: string, tab: string): string =>
  `${server}/sim?replay=${encodeURIComponent(id)}&tab=${tab}`;

// ── The toolbox's list, past 50 lines ─────────────────────────────────────

/** The parts of the toolbox's list that are its lines: fold heads, department lines and rows. */
export const LINE_PARTS = '[data-fold-head], [data-dept-line], [data-tool-row]';

/** One line of the toolbox's list, as the page renders it. */
export interface ToolboxLine {
  kind: 'head' | 'dept' | 'row';
  /** Its place among the list's lines: its data-line, or its place in the page where the list renders whole. */
  at: number;
  /** A head's or a row's place in the whole list and that list's size (aria-posinset, aria-setsize); NaN where unset. */
  pos: number;
  size: number;
  /** The fold that holds it (data-fold), or '' in a list with no folds. */
  fold: string;
  /** A head's fold name (data-fold-head), a department line's words, a row's tool name. */
  name: string;
  /** A row's actor label (data-actor). */
  actor: string;
  /** A row's meta line, or a head's count line or error. */
  meta: string;
  /** A row's "Same name" words. */
  same: string;
  /** A head's note on a full registry. */
  note: string;
  /** A head key's aria-expanded, or null on a head with no rows to open. */
  expanded: string | null;
  /** How many side marks a row draws. */
  sideMarks: number;
}

interface WalkArg {
  op: 'read' | 'reveal' | 'step' | 'tail';
  /** reveal: the part to scroll into view. */
  selector: string;
  /** step: how far to scroll, as a share of the view's height. */
  share: number;
  /** read: how many lines to read from the top, 0 for every line. tail: how many lines to read back from the end. */
  count: number;
}

interface WalkResult {
  lines: ToolboxLine[];
  found: boolean;
  moved: boolean;
  covered: boolean;
  rendered: number;
  heads: string[];
}

/**
 * Walks the toolbox's list in the page, which renders the lines in view past
 * 50 (data-windowed="true" on the list, data-line on each line). After each
 * scroll it waits until the lines rendered cover the view, so no line is
 * passed unread.
 * - read: from the top to the end, every line read once, or only as far as
 *   its first `count` lines; then back to the top
 * - tail: to the list's end, then back up until its last `count` lines are read
 * - reveal: from the top until the selector matches a rendered part, then that part centred in view
 * - step: one scroll by a share of the view, then what is rendered
 * Where the list renders whole, read, tail and reveal read the page as it stands.
 */
async function walkList(root: Element, arg: WalkArg): Promise<WalkResult> {
  const result: WalkResult = { lines: [], found: false, moved: false, covered: true, rendered: 0, heads: [] };
  const list = root.querySelector<HTMLElement>('[data-toolbox-rows]');
  if (!list) return result;
  const windowed = list.getAttribute('data-windowed') === 'true';
  const count = Number(list.getAttribute('data-line-count'));
  let scroller: HTMLElement | null = list.parentElement;
  while (scroller && scroller !== document.body) {
    const { overflowY } = getComputedStyle(scroller);
    if (/(auto|scroll|overlay)/.test(overflowY) && scroller.scrollHeight > scroller.clientHeight + 1) break;
    scroller = scroller.parentElement;
  }
  if (scroller === document.body) scroller = null;
  const box = scroller ?? (document.scrollingElement as HTMLElement);
  const viewHeight = () => (scroller ? scroller.clientHeight : window.innerHeight);
  const frame = () => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  const parts = () => Array.from(list.querySelectorAll<HTMLElement>('[data-fold-head], [data-dept-line], [data-tool-row]'));
  const covered = (): boolean => {
    if (!windowed) return true;
    const shown = list.querySelectorAll<HTMLElement>('[data-line]');
    if (shown.length === 0) return count === 0;
    const first = shown[0];
    const last = shown[shown.length - 1];
    let viewTop = 0;
    let viewBottom = window.innerHeight;
    if (scroller) {
      const s = scroller.getBoundingClientRect();
      viewTop = s.top + scroller.clientTop;
      viewBottom = viewTop + scroller.clientHeight;
    }
    const r = list.getBoundingClientRect();
    const top = Math.max(viewTop, r.top);
    const bottom = Math.min(viewBottom, r.bottom);
    if (bottom <= top) return true;
    const topOk = Number(first.dataset.line) === 0 || first.getBoundingClientRect().top <= top + 1;
    const bottomOk = Number(last.dataset.line) === count - 1 || last.getBoundingClientRect().bottom >= bottom - 1;
    return topOk && bottomOk;
  };
  // Two frames in a row with the view covered, after the list has caught up with the scroll.
  const settle = async (): Promise<boolean> => {
    for (let i = 0; i < 240; i += 1) {
      await frame();
      if (covered()) {
        await frame();
        if (covered()) return true;
      }
    }
    return false;
  };
  const num = (value: string | null | undefined): number => (value == null ? Number.NaN : Number(value));
  const read = (el: HTMLElement, at: number): ToolboxLine => {
    const fold = el.closest<HTMLElement>('[data-fold]');
    const base: ToolboxLine = {
      kind: 'row', at, pos: Number.NaN, size: Number.NaN, fold: fold?.getAttribute('data-fold') ?? '',
      name: '', actor: '', meta: '', same: '', note: '', expanded: null, sideMarks: 0,
    };
    if (el.hasAttribute('data-fold-head')) {
      return {
        ...base,
        kind: 'head',
        pos: num(fold?.getAttribute('aria-posinset')),
        size: num(fold?.getAttribute('aria-setsize')),
        name: el.getAttribute('data-fold-head') ?? '',
        meta: (el.querySelector('[data-fold-count]') ?? el.querySelector('[data-fold-error]'))?.textContent ?? '',
        note: el.querySelector('[data-fold-note]')?.textContent ?? '',
        expanded: el.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') ?? null,
      };
    }
    if (el.hasAttribute('data-dept-line')) return { ...base, kind: 'dept', name: el.textContent ?? '' };
    return {
      ...base,
      pos: num(el.getAttribute('aria-posinset')),
      size: num(el.getAttribute('aria-setsize')),
      name: el.getAttribute('data-tool-name') ?? '',
      actor: el.getAttribute('data-actor') ?? '',
      meta: el.querySelector('[data-row-meta]')?.textContent ?? '',
      same: el.querySelector('[data-row-same]')?.textContent ?? '',
      sideMarks: el.querySelectorAll('[data-side-mark]').length,
    };
  };
  const seen = new Map<number, ToolboxLine>();
  const collect = () => {
    parts().forEach((el, i) => {
      const line = el.closest<HTMLElement>('[data-line]');
      const at = line ? Number(line.dataset.line) : i;
      seen.set(at, read(el, at));
    });
  };
  const scrollBy = (by: number): boolean => {
    const before = box.scrollTop;
    box.scrollTop = before + by;
    return box.scrollTop > before + 0.5;
  };

  if (arg.op === 'step') {
    result.moved = scrollBy(Math.max(40, viewHeight() * arg.share));
    result.covered = await settle();
    const shown = parts();
    result.rendered = shown.length;
    result.heads = shown.filter(el => el.hasAttribute('data-fold-head')).map(el => el.getAttribute('data-fold-head') ?? '');
    return result;
  }

  if (arg.op === 'tail') {
    if (windowed) {
      // The heights of lines not rendered yet are estimates, so the end moves as they render: scroll to it until the last line is rendered.
      let atEnd = false;
      for (let i = 0; i < 40 && !atEnd; i += 1) {
        box.scrollTop = box.scrollHeight;
        if (!await settle()) throw new Error('The toolbox\'s list did not render the lines in view at its end.');
        const shown = list.querySelectorAll<HTMLElement>('[data-line]');
        atEnd = shown.length > 0 && Number(shown[shown.length - 1].dataset.line) === count - 1;
      }
      if (!atEnd) throw new Error('The toolbox\'s list did not render its last line at its end.');
      collect();
      const first = Math.max(0, count - arg.count);
      while (!seen.has(first)) {
        const before = box.scrollTop;
        box.scrollTop = Math.max(0, before - Math.max(40, viewHeight() * 0.8));
        if (box.scrollTop > before - 0.5) break;
        if (!await settle()) throw new Error(`The toolbox's list did not render the lines in view at ${Math.round(box.scrollTop)} px.`);
        collect();
      }
    } else {
      collect();
    }
    const all = [...seen.values()].sort((a, b) => a.at - b.at);
    const last = all.slice(Math.max(0, all.length - arg.count));
    // Read from the end upwards, the lines must follow one another: a gap is a line the scroll passed unread.
    last.forEach((line, i) => {
      if (line.at !== last[0].at + i) throw new Error(`The toolbox's list passed line ${last[0].at + i} unread on the way back from its end.`);
    });
    result.lines = last;
    return result;
  }

  const target = () => (arg.op === 'reveal' ? list.querySelector<HTMLElement>(arg.selector) : null);
  // A reveal stops at its part; a read of the first lines stops once the last of them is read.
  const enough = () => (arg.op === 'reveal' ? target() !== null : arg.count > 0 && seen.has(arg.count - 1));
  if (windowed) {
    box.scrollTop = 0;
    if (!await settle()) throw new Error('The toolbox\'s list did not render the lines in view at its top.');
    collect();
    while (!enough()) {
      if (!scrollBy(Math.max(40, viewHeight() * 0.8))) break;
      if (!await settle()) throw new Error(`The toolbox's list did not render the lines in view at ${Math.round(box.scrollTop)} px.`);
      collect();
    }
  } else {
    collect();
  }
  const found = target();
  if (arg.op === 'reveal') {
    if (found === null) throw new Error(`The toolbox's list holds no part that matches ${arg.selector}.`);
    found.scrollIntoView({ block: 'center' });
    if (windowed && !await settle()) throw new Error('The toolbox\'s list did not render the lines in view.');
    result.found = true;
  } else if (windowed) {
    box.scrollTop = 0;
    await settle();
  }
  const lines = [...seen.values()].sort((a, b) => a.at - b.at);
  result.lines = arg.op === 'read' && arg.count > 0 ? lines.slice(0, arg.count) : lines;
  return result;
}

/**
 * Every line of the toolbox's list in order, read by scrolling it from its
 * top to its end; the list is left at its top.
 */
export async function readAllLines(list: Locator): Promise<ToolboxLine[]> {
  return (await list.evaluate(walkList, { op: 'read', selector: '', share: 0, count: 0 })).lines;
}

/**
 * The first lines of the toolbox's list in order, or its last, without the
 * scroll through all of it: from 'top' the first `count`, read down from its
 * top, the list left at its top; from 'end' the last `count`, read back up
 * from its end, the list left where the read stopped. A list that holds
 * fewer lines gives them all.
 */
export async function readLinesFrom(list: Locator, from: 'top' | 'end', count: number): Promise<ToolboxLine[]> {
  return (await list.evaluate(walkList, { op: from === 'top' ? 'read' : 'tail', selector: '', share: 0, count })).lines;
}

/** Scrolls the toolbox's list from its top until a part that matches the selector renders, and centres that part in view. */
export async function revealLine(list: Locator, selector: string): Promise<void> {
  await list.evaluate(walkList, { op: 'reveal', selector, share: 0, count: 0 });
}

/**
 * Scrolls the toolbox's list by a share of its view's height and waits for
 * it to render the lines in view. Says whether it moved, whether the lines
 * rendered then cover the view, how many lines are rendered, and which fold
 * heads, by their names.
 */
export async function scrollListBy(list: Locator, share: number): Promise<{ moved: boolean; covered: boolean; rendered: number; heads: string[] }> {
  const { moved, covered, rendered, heads } = await list.evaluate(walkList, { op: 'step', selector: '', share, count: 0 });
  return { moved, covered, rendered, heads };
}
