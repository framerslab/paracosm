/**
 * Click-to-zoom diagram viewer matching the landing.html implementation.
 *
 * UX:
 * - Trigger button shows the SVG with a "Click to expand" badge.
 * - Click opens a full-screen modal with pan + zoom controls.
 * - Modal background matches the page theme (html.light class).
 *
 * Accessibility:
 * - Trigger is a real `<button>` with aria-label.
 * - Modal is role="dialog" aria-modal="true" with a labelled SR-only title.
 * - Toolbar has role="toolbar" and live-region zoom percentage.
 * - Tab cycles focus inside the modal.
 * - Esc closes; +/- adjust zoom; 0 resets.
 * - Focus restores to the trigger on close.
 *
 * Theme:
 * - Inlines the SVG on open so `prefers-color-scheme` queries inside the
 *   SVG resolve against the modal's color-scheme rather than the OS
 *   preference, matching the page's manual light/dark toggle.
 *
 * @module dashboard/about/ZoomableDiagram
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './AboutPage.module.scss';

const MIN_ZOOM = 50;
const MAX_ZOOM = 400;
const DEFAULT_ZOOM = 100;
const ZOOM_STEP = 10;

interface ZoomableDiagramProps {
  src: string;
  alt: string;
  caption?: string;
  width: number;
  height: number;
  /** Used for the SR-only modal title. */
  title?: string;
}

/** Read the page's current theme (html.light class) — matches the rest
 *  of the dashboard's theme switcher rather than the OS preference. */
function readIsLight(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('light');
}

interface MediaBlock {
  head: string;
  body: string;
}

/**
 * Brace-counting parser for `@media (prefers-color-scheme: …) { … }`
 * blocks. Replaces the original `[\s\S]*?` regex which would stop at
 * the first inner `}` and mishandle nested rule blocks. Returns the
 * extracted blocks plus the original CSS with every matched block
 * removed in one pass, so the caller can rewrite the stylesheet
 * without parsing twice. We control the SVG content today, but
 * keeping the parser brace-aware means a future change that nests
 * rules inside `:root` won't silently produce broken theme blocks.
 */
function extractPrefersColorSchemeBlocks(css: string): { blocks: MediaBlock[]; withoutBlocks: string } {
  const blocks: MediaBlock[] = [];
  const headRegex = /@media\s*\(\s*prefers-color-scheme:[^)]*\)\s*\{/g;
  let withoutBlocks = '';
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = headRegex.exec(css)) !== null) {
    const headStart = match.index;
    const headEnd = headRegex.lastIndex; // points just past the opening `{`
    let depth = 1;
    let cursor = headEnd;
    while (cursor < css.length && depth > 0) {
      const ch = css.charCodeAt(cursor);
      if (ch === 123 /* { */) depth += 1;
      else if (ch === 125 /* } */) depth -= 1;
      cursor += 1;
    }
    // depth === 0 → cursor is one past the matching `}`.
    if (depth !== 0) {
      // Unbalanced block. Bail out: leave the rest of the css intact
      // so we don't corrupt the stylesheet — we'd rather show a stale
      // OS-preference-driven SVG than blow it up entirely.
      withoutBlocks += css.slice(lastEnd);
      return { blocks, withoutBlocks };
    }
    blocks.push({
      head: css.slice(headStart, headEnd),
      body: css.slice(headEnd, cursor - 1).trim(),
    });
    withoutBlocks += css.slice(lastEnd, headStart);
    lastEnd = cursor;
    headRegex.lastIndex = cursor;
  }
  withoutBlocks += css.slice(lastEnd);
  return { blocks, withoutBlocks };
}

/** Pull the body out of a leading `:root { … }` rule inside an @media
 *  block. Same brace-counting strategy as `extractPrefersColorSchemeBlocks`
 *  so a nested `{}` inside the variable definitions wouldn't truncate
 *  the body early. */
function extractRootBlockBody(blockBody: string): string | null {
  const rootMatch = blockBody.match(/:root\s*\{/);
  if (!rootMatch || rootMatch.index == null) return null;
  const start = rootMatch.index + rootMatch[0].length;
  let depth = 1;
  let cursor = start;
  while (cursor < blockBody.length && depth > 0) {
    const ch = blockBody.charCodeAt(cursor);
    if (ch === 123) depth += 1;
    else if (ch === 125) depth -= 1;
    cursor += 1;
  }
  if (depth !== 0) return null;
  return blockBody.slice(start, cursor - 1).trim();
}

export function ZoomableDiagram({
  src,
  alt,
  caption,
  width,
  height,
  title = 'Diagram zoom viewer',
}: ZoomableDiagramProps) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isLight, setIsLight] = useState(readIsLight);
  const [inlineSvg, setInlineSvg] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  // Unique ID per ZoomableDiagram instance so multiple diagrams mounted
  // on the same page don't share an `aria-labelledby` target. React's
  // useId is SSR-stable so the hook is safe to call here regardless of
  // SSR context.
  const titleId = useId();

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  /** Pan-drag state lives in refs to avoid React re-render thrash on
   *  every mousemove. `panRef` shadows the `pan` state so the
   *  mouse/touch listeners read the latest pan without needing to be
   *  re-bound when the state updates — keeping the listeners stable
   *  across drag ticks is what fixes the "rebind every frame" loop
   *  that the previous pan.x/pan.y deps array introduced. */
  const panningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const lastTouchRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  /** Watch the html.light class so the modal background and inlined SVG
   *  theme follow the dashboard's theme toggle, not the OS preference. */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const obs = new MutationObserver(() => setIsLight(readIsLight()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  /** Lock body scroll + manage focus while the modal is mounted. */
  useEffect(() => {
    if (!open) return;
    const previousFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the close button (last button in toolbar) for fastest dismiss
    // via Enter/Space; falls back to the dialog if buttons aren't ready.
    requestAnimationFrame(() => {
      const close = dialogRef.current?.querySelector<HTMLButtonElement>('[data-zoom-action="close"]');
      if (close) close.focus();
      else dialogRef.current?.focus();
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      previousFocused?.focus?.();
    };
  }, [open]);

  /** Fetch + inline the SVG on first open so prefers-color-scheme inside
   *  resolves against the modal context. */
  useEffect(() => {
    if (!open || inlineSvg !== null || fetchFailed) return;
    let cancelled = false;
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((text) => {
        if (cancelled) return;
        setInlineSvg(text);
      })
      .catch(() => {
        if (cancelled) return;
        setFetchFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, src, inlineSvg, fetchFailed]);

  /** Modify the inlined SVG: set data-theme + strip prefers-color-scheme
   *  blocks (re-applying the matching :root values as an SVG-scoped rule
   *  when the page is in light mode). Runs whenever the inlined HTML or
   *  the theme changes. */
  useEffect(() => {
    if (!open || !inlineSvg || !wrapRef.current) return;
    const wrap = wrapRef.current;

    const parser = new DOMParser();
    const doc = parser.parseFromString(inlineSvg, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return;

    svgEl.style.width = '100%';
    svgEl.style.height = 'auto';
    svgEl.style.display = 'block';
    svgEl.style.pointerEvents = 'none';
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    svgEl.setAttribute('data-theme', isLight ? 'light' : 'dark');

    svgEl.querySelectorAll('style').forEach((styleEl) => {
      const css = styleEl.textContent || '';
      const media = extractPrefersColorSchemeBlocks(css);
      if (!media.blocks.length) return;
      let rewritten = media.withoutBlocks;
      if (isLight) {
        // Pull the `:root { ... }` body out of the light-mode block so
        // the modal's `data-theme="light"` actually applies the light
        // variables to the SVG without needing the OS to also be light.
        const lightBlock = media.blocks.find(b => /prefers-color-scheme:\s*light/i.test(b.head));
        if (lightBlock) {
          const rootBody = extractRootBlockBody(lightBlock.body);
          if (rootBody) rewritten += `\nsvg{${rootBody}}\n`;
        }
      }
      if (rewritten !== css) styleEl.textContent = rewritten;
    });

    while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
    wrap.appendChild(svgEl);
  }, [inlineSvg, isLight, open]);

  const handleClose = useCallback(() => setOpen(false), []);

  const applyZoomDelta = useCallback((delta: number) => {
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z + delta))));
  }, []);

  const handleReset = useCallback(() => {
    setZoom(DEFAULT_ZOOM);
    setPan({ x: 0, y: 0 });
  }, []);

  /** Keyboard: Esc / +/- / 0 / Tab trap inside the dialog. */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        applyZoomDelta(ZOOM_STEP);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        applyZoomDelta(-ZOOM_STEP);
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        handleReset();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, applyZoomDelta, handleReset, handleClose]);

  /** Mouse + touch drag pan. Listeners are bound once per `open` change
   *  and read mutable pan state from `panRef` / `lastTouchRef` rather
   *  than from the `pan` state value, so the effect doesn't re-bind
   *  itself on every drag tick (which would tear down + re-attach
   *  listeners mid-gesture and visibly stutter the pan). */
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      panningRef.current = true;
      panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
      container.style.cursor = 'grabbing';
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!panningRef.current) return;
      setPan({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y });
    };
    const onUp = () => {
      if (panningRef.current) {
        panningRef.current = false;
        container.style.cursor = 'grab';
      }
    };
    container.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      setPan((p) => ({
        x: p.x + (t.clientX - lastTouchRef.current.x),
        y: p.y + (t.clientY - lastTouchRef.current.y),
      }));
      lastTouchRef.current = { x: t.clientX, y: t.clientY };
      e.preventDefault();
    };
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      applyZoomDelta(delta);
    };
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('wheel', onWheel);
    };
    // `pan.x` and `pan.y` are intentionally absent from the deps so the
    // handlers stay bound across drag ticks; they read the latest pan
    // through `panRef.current` instead. Adding them back would re-bind
    // every frame and stutter the pan visibly.
  }, [open, applyZoomDelta]);

  const wrapTransform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`;
  const modalBg = isLight ? '#f0e6d2' : '#0a0806';

  return (
    <>
      <figure className={styles.flowDiagram}>
        <button
          ref={triggerRef}
          type="button"
          className={styles.flowDiagramTrigger}
          onClick={() => setOpen(true)}
          aria-label={`Open the ${title.toLowerCase()} in a zoomable full-screen viewer`}
        >
          <img
            src={src}
            alt={alt}
            className={styles.flowDiagramImg}
            loading="lazy"
            decoding="async"
            width={width}
            height={height}
          />
          <span className={styles.flowDiagramBadge} aria-hidden="true">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              focusable="false"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.5" y2="16.5" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
            Click to expand
          </span>
        </button>
        {caption && <figcaption className={styles.flowDiagramCaption}>{caption}</figcaption>}
      </figure>

      {open && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={styles.zoomBackdrop}
            onClick={(e) => {
              if (e.target === e.currentTarget) handleClose();
            }}
          >
            <h2 id={titleId} className="sr-only">{title}</h2>
            <div role="toolbar" aria-label="Diagram zoom controls" className={styles.zoomToolbar}>
              <button
                type="button"
                className={styles.zoomButton}
                onClick={() => applyZoomDelta(-ZOOM_STEP)}
                title="Zoom out (− key)"
                aria-label="Zoom out"
              >
                −
              </button>
              <span
                className={styles.zoomLabel}
                aria-live="polite"
                aria-atomic="true"
              >
                {zoom}%
              </span>
              <button
                type="button"
                className={styles.zoomButton}
                onClick={() => applyZoomDelta(ZOOM_STEP)}
                title="Zoom in (+ key)"
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                className={styles.zoomButton}
                onClick={handleReset}
                title="Reset zoom and position (0 key)"
                aria-label="Reset zoom and position"
              >
                Reset
              </button>
              <span className={styles.zoomSep} aria-hidden="true" />
              <button
                type="button"
                className={styles.zoomButton}
                onClick={handleClose}
                title="Close (Escape key)"
                aria-label="Close diagram viewer"
                data-zoom-action="close"
              >
                ✕  Close
              </button>
            </div>
            <div
              ref={containerRef}
              className={styles.zoomContainer}
              style={{ background: modalBg, colorScheme: isLight ? 'light' : 'dark' }}
            >
              <div
                ref={wrapRef}
                className={styles.zoomSvgWrap}
                style={{ transform: wrapTransform, colorScheme: isLight ? 'light' : 'dark' }}
              >
                {/* Fetched + inlined by the effect above. Placeholder
                    img shows immediately so the modal isn't empty during
                    the fetch round-trip on slow connections. */}
                {!inlineSvg && (
                  <img
                    src={src}
                    alt={alt}
                    className={styles.zoomPlaceholder}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
