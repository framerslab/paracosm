import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { OVERSCAN, WINDOW_PAST, windowRange, type WindowRange } from './windowedLines';

/**
 * Past 50 lines the forged toolbox renders only the lines in view, and keeps
 * the keyboard order, the focus and what a screen reader counts.
 *
 * The list marks each line it renders with `data-line`, its place among the
 * lines. `useWindowedLines` follows the list's scroll and measures each line
 * it renders, so the lines not rendered keep their room and the scroll bar
 * its place. `useLineFocus` keeps the line that holds focus rendered, moves
 * Tab on to a line not yet rendered, keeps a line's place in the Tab order
 * when Tab enters the list, and gives focus to a fold's head when the line
 * that held it leaves with its fold.
 */

/** One line of a windowed list. */
export interface WindowLine {
  /** The line's own key, the same from render to render: its measured height is kept by it. */
  key: string;
  /** Lines of one kind take the height measured on their kind until each is measured. */
  kind: string;
  /** The height to take before any line of its kind is measured, in px. */
  estimate: number;
  /** Whether the line holds a control that takes focus. */
  focusable: boolean;
  /** The line that takes focus when this one leaves with focus inside: its fold's head. */
  headKey?: string;
}

export interface WindowedLines extends WindowRange {
  /** Whether the list holds more than 50 lines and renders only the lines in view. */
  windowed: boolean;
  /** Scrolls the list's view so a line stands in it; the list renders it on its next update. */
  scrollToLine: (index: number) => void;
}

/** What a control that takes focus by Tab matches. */
const TABBABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The element the list scrolls in: the nearest one that scrolls, or none for the page itself. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && node.scrollHeight > node.clientHeight + 1) return node;
  }
  return null;
}

/** The part of the page the list shows in: its top and bottom in the window. */
function viewOf(parent: HTMLElement | null): { top: number; bottom: number; padTop: number } {
  if (!parent) return { top: 0, bottom: window.innerHeight, padTop: 0 };
  const box = parent.getBoundingClientRect();
  const top = box.top + parent.clientTop;
  const padTop = Number.parseFloat(getComputedStyle(parent).scrollPaddingTop);
  return { top, bottom: top + parent.clientHeight, padTop: Number.isFinite(padTop) ? padTop : 0 };
}

interface View {
  /** How far below the list's top the view starts, in px. */
  scrollTop: number;
  /** How much of the list the view can show, in px. */
  viewport: number;
}

function readView(listEl: HTMLElement): View {
  const list = listEl.getBoundingClientRect();
  const { top, bottom } = viewOf(scrollParentOf(listEl));
  return { scrollTop: Math.max(0, top - list.top), viewport: Math.max(0, bottom - Math.max(top, list.top)) };
}

/**
 * The lines to render of a list held by `listEl`: every line up to 50, and
 * past 50 the lines in view, eight more past each end, and the line at
 * `focusIndex` wherever it stands, apart from them as `kept` when it is
 * further away. The list keeps `padTop` and `padBottom` as room for the
 * lines it leaves out, and `gap` between the kept line and the others.
 */
export function useWindowedLines(lines: readonly WindowLine[], listEl: HTMLElement | null, focusIndex: number | null): WindowedLines {
  const windowed = lines.length > WINDOW_PAST;
  const measured = useRef(new Map<string, number>());
  const kinds = useRef(new Map<string, { sum: number; n: number }>());
  const measuredWidth = useRef(-1);
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<View>(() => ({ scrollTop: 0, viewport: typeof window === 'undefined' ? 0 : window.innerHeight }));

  const heights = useMemo(() => {
    void version;
    return lines.map((line) => {
      const known = measured.current.get(line.key);
      if (known !== undefined) return known;
      const kind = kinds.current.get(line.kind);
      return kind && kind.n > 0 ? kind.sum / kind.n : line.estimate;
    });
  }, [lines, version]);

  const keep = focusIndex !== null && focusIndex >= 0 && focusIndex < lines.length ? focusIndex : undefined;
  const range: WindowRange = windowed
    ? windowRange({ count: lines.length, lineHeights: heights, scrollTop: view.scrollTop, viewport: view.viewport, overscan: OVERSCAN, keep })
    : { first: 0, last: lines.length - 1, padTop: 0, padBottom: 0 };

  const latest = useRef({ heights, range, keep, windowed });
  latest.current = { heights, range, keep, windowed };

  // Reads the view and renders the lines it now shows, when they differ from the lines rendered.
  const update = useCallback(() => {
    const now = latest.current;
    if (!listEl || !now.windowed) return;
    const next = readView(listEl);
    const nextRange = windowRange({ count: now.heights.length, lineHeights: now.heights, scrollTop: next.scrollTop, viewport: next.viewport, overscan: OVERSCAN, keep: now.keep });
    if (nextRange.first !== now.range.first || nextRange.last !== now.range.last || nextRange.kept !== now.range.kept) setView(next);
  }, [listEl]);

  // The view follows every scroll (the toolbox's own, or the page's in Reports) and every change of size.
  useEffect(() => {
    if (!listEl) return undefined;
    let frame = 0;
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(() => { frame = 0; update(); });
    };
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(listEl);
    schedule();
    return () => {
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [listEl, update]);

  // Each rendered line is measured; a new width measures every line again.
  useLayoutEffect(() => {
    if (!listEl) return;
    const width = listEl.clientWidth;
    if (width > 0 && Math.abs(width - measuredWidth.current) > 1) {
      measured.current.clear();
      kinds.current.clear();
      measuredWidth.current = width;
    }
    let changed = false;
    for (const node of listEl.querySelectorAll<HTMLElement>('[data-line]')) {
      const line = lines[Number(node.dataset.line)];
      if (!line) continue;
      const h = node.getBoundingClientRect().height;
      if (!(h > 0)) continue;
      const was = measured.current.get(line.key);
      if (was !== undefined && Math.abs(was - h) < 0.5) continue;
      measured.current.set(line.key, h);
      const kind = kinds.current.get(line.kind) ?? { sum: 0, n: 0 };
      if (was === undefined) {
        kind.sum += h;
        kind.n += 1;
      } else {
        kind.sum += h - was;
      }
      kinds.current.set(line.kind, kind);
      changed = true;
    }
    if (changed) setVersion((v) => v + 1);
    else update();
  });

  // Brings a line into the view by the least scroll that shows it below the view's scroll padding.
  const scrollToLine = useCallback((index: number) => {
    const now = latest.current;
    if (!listEl || index < 0 || index >= now.heights.length) return;
    let offset = 0;
    for (let i = 0; i < index; i += 1) offset += now.heights[i];
    const parent = scrollParentOf(listEl);
    const { top, bottom, padTop } = viewOf(parent);
    const lineTop = listEl.getBoundingClientRect().top + offset;
    const lineBottom = lineTop + now.heights[index];
    const by = lineTop < top + padTop ? lineTop - (top + padTop) : lineBottom > bottom ? lineBottom - bottom : 0;
    if (by !== 0) {
      if (parent) parent.scrollTop += by;
      else window.scrollBy(0, by);
    }
    update();
  }, [listEl, update]);

  return { ...range, windowed, scrollToLine };
}

/** The next line from `from` in a direction that holds a control taking focus, or -1. */
function nextFocusable(lines: readonly WindowLine[], from: number, step: 1 | -1): number {
  for (let i = from + step; i >= 0 && i < lines.length; i += step) if (lines[i].focusable) return i;
  return -1;
}

/** The first or the last line that holds a control taking focus, or -1. */
function edgeFocusable(lines: readonly WindowLine[], step: 1 | -1): number {
  return nextFocusable(lines, step === 1 ? -1 : lines.length, step);
}

export interface LineFocus {
  /** The line that holds focus, which the list keeps rendered; null when none does. */
  keep: number | null;
  /** Set by the list to its `scrollToLine`, which brings a line not yet rendered into view. */
  scrollTo: RefObject<((index: number) => void) | null>;
}

/**
 * Focus in a windowed list of lines held by `listEl`.
 *
 * - The line that holds focus stays rendered, also while the focus is in a
 *   dialog opened from it, so focus can come back to it.
 * - Tab or Shift+Tab on a line whose next line is not rendered renders that
 *   line and moves focus to it, so every line keeps its place in the Tab
 *   order and the dialog's focus trap never skips the lines not rendered.
 * - Tab entering the list from before it lands on its first line, and
 *   Shift+Tab entering from after it on its last.
 * - A line that leaves with focus inside, as when its fold closes, gives
 *   focus to its fold's head.
 */
export function useLineFocus(lines: readonly WindowLine[], listEl: HTMLElement | null): LineFocus {
  const [focused, setFocused] = useState<{ key: string; headKey?: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const scrollTo = useRef<((index: number) => void) | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const tabbing = useRef<0 | 1 | -1>(0);
  const tries = useRef(0);

  // A Tab press, and its direction, for the focus it moves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      tabbing.current = e.shiftKey ? -1 : 1;
      window.setTimeout(() => { tabbing.current = 0; }, 0);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    if (!listEl) return undefined;
    const lineOf = (node: EventTarget | null): number => {
      const el = node instanceof Element ? node.closest<HTMLElement>('[data-line]') : null;
      return el && listEl.contains(el) ? Number(el.dataset.line) : -1;
    };
    const ask = (key: string) => {
      tries.current = 0;
      setPending(key);
    };

    const onFocusIn = (e: FocusEvent) => {
      const all = linesRef.current;
      const i = lineOf(e.target);
      const line = all[i];
      if (!line) return;
      const from = e.relatedTarget;
      const dir = tabbing.current;
      if (dir !== 0 && !(from instanceof Node && listEl.contains(from))) {
        // Tab entered the list: it lands on its first line, Shift+Tab on its last.
        const edge = edgeFocusable(all, dir);
        if (edge >= 0 && edge !== i) ask(all[edge].key);
      }
      setFocused((was) => (was?.key === line.key ? was : { key: line.key, headKey: line.headKey }));
    };

    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget;
      if (!(to instanceof Node) || listEl.contains(to)) return;
      // Focus went to another control of the same dialog or list: no line need stay rendered for it.
      const root = listEl.closest('[role="dialog"]') ?? listEl.closest('[data-toolbox-list]');
      if (root?.contains(to)) setFocused(null);
    };

    // Before the dialog's focus trap: Tab towards a line not rendered renders it and moves focus there.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
      const all = linesRef.current;
      const i = lineOf(e.target);
      if (i < 0) return;
      const j = nextFocusable(all, i, e.shiftKey ? -1 : 1);
      if (j < 0 || listEl.querySelector(`[data-line="${j}"]`)) return;
      e.preventDefault();
      e.stopPropagation();
      ask(all[j].key);
    };

    listEl.addEventListener('focusin', onFocusIn);
    listEl.addEventListener('focusout', onFocusOut);
    listEl.addEventListener('keydown', onKeyDown, true);
    return () => {
      listEl.removeEventListener('focusin', onFocusIn);
      listEl.removeEventListener('focusout', onFocusOut);
      listEl.removeEventListener('keydown', onKeyDown, true);
    };
  }, [listEl]);

  useLayoutEffect(() => {
    if (!listEl) return;
    // A line asked for: focus it once rendered, or bring it into view first.
    if (pending !== null) {
      const i = lines.findIndex((line) => line.key === pending);
      const node = i >= 0 ? listEl.querySelector<HTMLElement>(`[data-line="${i}"]`) : null;
      if (node) {
        setPending(null);
        const target = node.matches(TABBABLE) ? node : node.querySelector<HTMLElement>(TABBABLE);
        target?.focus();
        return;
      }
      tries.current += 1;
      if (i < 0 || tries.current > 3) setPending(null);
      else scrollTo.current?.(i);
      return;
    }
    // The line that held focus left with its fold: focus goes to the fold's head.
    if (focused && !lines.some((line) => line.key === focused.key)) {
      const active = document.activeElement;
      const lost = active === null || active === document.body || !active.isConnected;
      if (lost && focused.headKey && lines.some((line) => line.key === focused.headKey)) {
        tries.current = 0;
        setPending(focused.headKey);
      } else {
        setFocused(null);
      }
    }
  });

  const keepKey = focused?.key ?? null;
  const keep = keepKey === null ? -1 : lines.findIndex((line) => line.key === keepKey);
  return { keep: keep >= 0 ? keep : null, scrollTo };
}
