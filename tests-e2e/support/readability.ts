/**
 * The readability figures of the forged tool view, measured on the built
 * page from computed styles: the contrast and size of every word, the
 * contrast of every glyph and edge, the size of every control, the rows of
 * keys, the first screen's counts, what the text spacing of WCAG 1.4.12
 * does to the layout, and where a picture of the page shows each word.
 *
 * A component marks its body text and headings with data-text="body" or
 * data-text="heading", and its code's line numbers with
 * data-text="lineNumber"; every other word is "other". A word takes the mark
 * of its nearest marked ancestor, so data-text="other" inside a marked part
 * sets it back.
 *
 * A colour is read against the ground it is drawn on: the nearest ancestor
 * with an opaque background, with every translucent ground between laid over
 * it, and the opacity of every part between applied to the colour.
 */
import type { Locator, Page } from '@playwright/test';

export type TextRole = 'body' | 'heading' | 'other' | 'lineNumber';

export interface TextMeasure {
  text: string;
  role: TextRole;
  px: number;
  ratio: number;
  selector: string;
  /** Words on an inactive key or item: they read at the glyphs' and edges' figure (FEATURES.md, Readability). */
  inactive?: boolean;
}

export interface GlyphMeasure { ratio: number; selector: string }

/**
 * One line of words a picture of the window shows: where it is drawn, and
 * what the page computes for it. A reader of the picture's pixels boxes the
 * line where it stands and holds it to the figure its role names.
 */
export interface WordBox {
  /** The words of the text this line belongs to. */
  text: string;
  role: TextRole;
  /** Words on an inactive key or item. */
  inactive?: boolean;
  /** This line's place among the lines its text is drawn on, from 1, and how many they are. */
  line: number;
  of: number;
  /** Left, top, width and height, each in per cent of the window. */
  box: [number, number, number, number];
  /** The computed font size, and the computed contrast against the ground the words are drawn on. */
  px: number;
  ratio: number;
}

/** One control a person presses, as the page lays it out. */
export interface Target {
  label: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
  /** A key: a control drawn with an edge all round (rule 21). */
  key: boolean;
}

export interface FirstScreen {
  controls: number;
  textStyles: number;
  rulesAndBoxes: number;
  colours: number;
  /** What each count counted, for a failure's message. */
  detail: { controls: string[]; textStyles: string[]; rulesAndBoxes: string[]; colours: string[] };
}

/** One header row or row of keys, by the selector that found it. */
export interface KeyRow {
  row: string;
  found: boolean;
  /** Its parts shown, each beside the others with none under another. */
  parts: number;
  oneRow: boolean;
  /** Every part inside the surface, left and right. */
  inside: boolean;
  /** How far the row's content is wider than the row. */
  scroll: number;
}

/** The figures, FEATURES.md "Readability" and DECISIONS.md rules 19 to 21. */
export const FIGURES = {
  bodyRatio: 12,
  otherRatio: 7,
  glyphRatio: 4.5,
  bodyPx: 18,
  otherPx: 15,
  lineNumberPx: 14,
  smallestPx: 14,
  phoneTarget: 44,
  desktopKey: 32,
  desktopGap: 8,
  /** Below this width a control is a phone's: 44 px tall. From it, a key is 32 px tall. */
  desktopFrom: 900,
} as const;

/** WCAG 1.4.12's text spacing, as the W3C's bookmarklet sets it, on the dialogs the spec reads; the run view under them keeps its own. */
export const TEXT_SPACING = [
  '[role="dialog"], [role="dialog"] * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }',
  '[role="dialog"] p { margin-bottom: 2em !important; }',
].join('\n');

const round2 = (n: number): number => Math.round(n * 100) / 100;

type Op = 'text' | 'glyphs' | 'targets' | 'first' | 'rows' | 'spacing' | 'words';

interface ReadArg {
  op: Op;
  /** first: how far down from the surface's top the first screen reaches. */
  region: number;
  /** rows: the selectors of the rows of keys. */
  rows: string[];
}

/**
 * Reads one surface in the page. Self-contained, since the page runs it:
 * every helper is declared inside.
 */
function readSurface(root: Element, arg: ReadArg): unknown {
  type RGBA = [number, number, number, number];
  type RGB = [number, number, number];

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const alphaOf = (v: string | undefined): number => {
    if (v === undefined) return 1;
    return v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v);
  };
  /** Any computed colour as red, green and blue from 0 to 255 and an alpha from 0 to 1. */
  const parse = (css: string): RGBA => {
    const s = css.trim();
    if (s === '' || s === 'transparent' || s === 'none') return [0, 0, 0, 0];
    let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), alphaOf(m[4])];
    m = /^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(s);
    if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, alphaOf(m[4])];
    if (!ctx) return [0, 0, 0, 0];
    // Any other notation: the canvas paints it and says what it painted.
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top: RGBA, under: RGB): RGB => [
    top[0] * top[3] + under[0] * (1 - top[3]),
    top[1] * top[3] + under[1] * (1 - top[3]),
    top[2] * top[3] + under[2] * (1 - top[3]),
  ];
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c: RGB): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratioOf = (a: RGB, b: RGB): number => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const r2 = (n: number): number => Math.round(n * 100) / 100;

  /** The ground under a part: the nearest opaque background at or above it, with each translucent one between laid over it. */
  const groundOf = (start: Element | null): { colour: RGB; from: Element | null } => {
    const layers: RGBA[] = [];
    for (let el = start; el; el = el.parentElement) {
      const bg = parse(getComputedStyle(el).backgroundColor);
      if (bg[3] >= 0.999) {
        let colour: RGB = [bg[0], bg[1], bg[2]];
        for (let i = layers.length - 1; i >= 0; i -= 1) colour = over(layers[i], colour);
        return { colour, from: el };
      }
      if (bg[3] > 0) layers.push(bg);
    }
    let colour: RGB = [255, 255, 255];
    for (let i = layers.length - 1; i >= 0; i -= 1) colour = over(layers[i], colour);
    return { colour, from: null };
  };
  /** The opacity of a part and every part above it, up to the part that gives its ground. */
  const opacityTo = (el: Element, stop: Element | null): number => {
    let o = 1;
    for (let at: Element | null = el; at && at !== stop; at = at.parentElement) o *= Number(getComputedStyle(at).opacity);
    return o;
  };
  /** A colour drawn on a part's ground, as the eye meets it, against that ground. */
  const contrast = (paint: RGBA, el: Element, groundFrom: Element | null): number => {
    if (paint[3] <= 0) return 1;
    const ground = groundOf(groundFrom);
    const drawn: RGBA = [paint[0], paint[1], paint[2], paint[3] * opacityTo(el, ground.from)];
    return r2(ratioOf(over(drawn, ground.colour), ground.colour));
  };

  const visibleNow = (el: Element, withOpacity: boolean): boolean => {
    const check = (el as unknown as { checkVisibility?: (o: Record<string, boolean>) => boolean }).checkVisibility;
    if (typeof check !== 'function') return true;
    return check.call(el, {
      visibilityProperty: true,
      checkVisibilityCSS: true,
      opacityProperty: withOpacity,
      checkOpacity: withOpacity,
    });
  };
  /**
   * Drawn on the page: laid out wider and taller than one pixel, not hidden,
   * and not inside a part clipped to a pixel or to nothing, as words kept for
   * a screen reader alone are (a 1 px box that clips, or clip-path inset(50%)).
   */
  const drawn = (el: Element, withOpacity = true): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || !visibleNow(el, withOpacity)) return false;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      const ar = a.getBoundingClientRect();
      const clipping = ['hidden', 'clip'].includes(s.overflowX) || ['hidden', 'clip'].includes(s.overflowY);
      if (s.clipPath === 'inset(50%)' || (clipping && (ar.width <= 1 || ar.height <= 1))) return false;
      if (a === root) break;
    }
    return true;
  };
  const SKIP = new Set(['OPTION', 'OPTGROUP', 'SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'TITLE']);
  /** The words a part draws itself: its own text nodes, a menu's chosen option, a field's value. */
  const ownText = (el: Element): string => {
    if (el instanceof SVGElement || SKIP.has(el.tagName)) return '';
    if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (el instanceof HTMLInputElement) return ['text', 'search'].includes(el.type) ? el.value.trim() : '';
    if (el instanceof HTMLTextAreaElement) return el.value.trim();
    let t = '';
    el.childNodes.forEach((n) => { if (n.nodeType === Node.TEXT_NODE) t += n.textContent ?? ''; });
    return t.replace(/\s+/g, ' ').trim();
  };
  const describe = (el: Element, text: string): string => {
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).map((c) => `.${c}`).join('') : '';
    const data = Array.from(el.attributes)
      .filter((a) => a.name.startsWith('data-') && a.name !== 'data-text')
      .map((a) => (a.value && a.value.length <= 24 ? `[${a.name}="${a.value}"]` : `[${a.name}]`))
      .join('');
    const label = el.getAttribute('aria-label');
    const said = text || label || '';
    return `${el.tagName.toLowerCase()}${cls}${data}${said ? ` "${said.length > 48 ? `${said.slice(0, 47)}…` : said}"` : ''}`;
  };
  const roleOf = (el: Element): string => {
    const marked = el.closest('[data-text]');
    const role = marked && root.contains(marked) ? marked.getAttribute('data-text') : null;
    return role === 'body' || role === 'heading' || role === 'lineNumber' ? role : 'other';
  };
  const inactive = (el: Element): boolean => el.closest('[aria-disabled="true"], :disabled') !== null;
  const parts = (): Element[] => [root, ...Array.from(root.querySelectorAll('*'))];
  /** The edges a part draws, one colour a drawn side. */
  const edgesOf = (cs: CSSStyleDeclaration): string[] => (['Top', 'Right', 'Bottom', 'Left'] as const)
    .filter((side) => parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0
      && !['none', 'hidden'].includes(cs.getPropertyValue(`border-${side.toLowerCase()}-style`))
      && parse(cs.getPropertyValue(`border-${side.toLowerCase()}-color`))[3] > 0)
    .map((side) => cs.getPropertyValue(`border-${side.toLowerCase()}-color`));
  const edgedAllRound = (cs: CSSStyleDeclaration): boolean => edgesOf(cs).length === 4;
  const outlineOf = (cs: CSSStyleDeclaration): string | null =>
    (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && parse(cs.outlineColor)[3] > 0 ? cs.outlineColor : null);
  const pseudoDrawn = (cs: CSSStyleDeclaration): boolean => cs.content !== 'none' && cs.content !== 'normal' && cs.display !== 'none';
  // A menu or a field draws its value in its own box, which scrolls.
  const field = (el: Element): boolean => el instanceof HTMLSelectElement || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  /** Where a part's own words are drawn: the line boxes of its own text nodes, not its box. */
  const drawnWords = (el: Element): DOMRect[] => {
    const out: DOMRect[] = [];
    el.childNodes.forEach((n) => {
      if (n.nodeType !== Node.TEXT_NODE || (n.textContent ?? '').trim() === '') return;
      const range = document.createRange();
      range.selectNodeContents(n);
      out.push(...Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0));
    });
    return out;
  };

  if (arg.op === 'text') {
    const out: Array<{ text: string; role: string; px: number; ratio: number; selector: string; inactive?: boolean }> = [];
    for (const el of parts()) {
      const text = ownText(el);
      if (!text || !drawn(el)) continue;
      const cs = getComputedStyle(el);
      const ratio = contrast(parse(cs.color), el, el);
      const off = inactive(el);
      out.push({ text, role: roleOf(el), px: parseFloat(cs.fontSize), ratio, selector: describe(el, text), ...(off ? { inactive: true } : {}) });
    }
    return out;
  }

  if (arg.op === 'glyphs') {
    const out: Array<{ ratio: number; selector: string }> = [];
    const add = (paint: string, el: Element, groundFrom: Element | null, what: string) => {
      const c = parse(paint);
      if (c[3] <= 0) return;
      out.push({ ratio: contrast(c, el, groundFrom), selector: `${what} ${describe(el, '')}` });
    };
    // The drawn glyphs: each reads by its strongest paint against its ground.
    for (const svg of Array.from(root.querySelectorAll('svg'))) {
      if (!drawn(svg) || svg.closest('[aria-hidden="true"]') === null) continue;
      const ground = groundOf(svg.parentElement);
      let best = 0;
      for (const shape of Array.from(svg.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse'))) {
        const cs = getComputedStyle(shape);
        const paints: Array<[string, number]> = [];
        if (cs.fill && cs.fill !== 'none' && !cs.fill.startsWith('url(')) paints.push([cs.fill, Number(cs.fillOpacity)]);
        if (cs.stroke && cs.stroke !== 'none' && !cs.stroke.startsWith('url(') && parseFloat(cs.strokeWidth) > 0) paints.push([cs.stroke, Number(cs.strokeOpacity)]);
        for (const [paint, opacity] of paints) {
          const c = parse(paint);
          const shown: RGBA = [c[0], c[1], c[2], c[3] * opacity * opacityTo(svg, ground.from)];
          if (shown[3] > 0) best = Math.max(best, ratioOf(over(shown, ground.colour), ground.colour));
        }
      }
      if (best > 0) out.push({ ratio: r2(best), selector: `glyph ${describe(svg, svg.getAttribute('data-glyph') ?? '')}` });
    }
    const MARKS = '[data-cell], [data-side-mark], [data-meter-fill], [role="meter"], [data-actor-rule]';
    const CONTROLS = 'button, select, textarea, summary, a[href], input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])';
    for (const el of parts()) {
      if (el instanceof SVGElement || !drawn(el)) continue;
      const cs = getComputedStyle(el);
      const hiddenMark = el.getAttribute('aria-hidden') === 'true' && (el.textContent ?? '').trim() === '';
      if (el.matches(MARKS) || hiddenMark) {
        // A cell, a band, a side mark, a rule or a track: its ground if it has one, else its edges; and an open station's ring.
        // A meter's fill reads against the ground outside the meter, as its track does (FEATURES.md's pairs).
        const meter = el.getAttribute('role') === 'meter' ? null : el.closest('[role="meter"]');
        const outside = meter ? meter.parentElement : el.parentElement;
        const bg = parse(cs.backgroundColor);
        if (bg[3] > 0) add(cs.backgroundColor, el, outside, 'mark');
        else for (const edge of new Set(edgesOf(cs))) add(edge, el, outside, 'mark edge');
        const ring = outlineOf(cs);
        if (ring) add(ring, el, outside, 'ring');
      } else if (el.matches(CONTROLS) || (el.tagName === 'LABEL' && el.querySelector('input, select') !== null)) {
        // A key's or a field's edge, against the ground outside it.
        for (const edge of new Set(edgesOf(cs))) add(edge, el, el.parentElement, 'edge');
      }
      // The line's rails, spurs and branches are drawn before or after a part.
      for (const which of ['::before', '::after'] as const) {
        const ps = getComputedStyle(el, which);
        if (!pseudoDrawn(ps)) continue;
        const bg = parse(ps.backgroundColor);
        if (bg[3] > 0) add(ps.backgroundColor, el, el, `${which} ground`);
        for (const edge of new Set(edgesOf(ps))) add(edge, el, el, `${which} edge`);
      }
    }
    return out;
  }

  if (arg.op === 'words') {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pct = (n: number, of: number): number => Math.round((n / of) * 100000) / 1000;
    const out: Array<{
      text: string; role: string; inactive?: boolean; line: number; of: number;
      box: [number, number, number, number]; px: number; ratio: number;
    }> = [];
    for (const el of parts()) {
      if (field(el)) continue;
      const text = ownText(el);
      // A character with no letter or digit (a dot between words, a key's mark) is a glyph, not a word.
      if (!/[\p{L}\p{N}]/u.test(text) || !drawn(el)) continue;
      const cs = getComputedStyle(el);
      const ratio = contrast(parse(cs.color), el, el);
      const off = inactive(el);
      // One box a line: the pieces of a line (its words, and the space a wrapped line ends on) share a top.
      const rows: Array<{ left: number; top: number; right: number; bottom: number }> = [];
      for (const r of drawnWords(el)) {
        const row = rows.find((q) => Math.abs(q.top - r.top) < 1);
        if (row) {
          row.left = Math.min(row.left, r.left);
          row.right = Math.max(row.right, r.right);
          row.bottom = Math.max(row.bottom, r.bottom);
        } else rows.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
      rows.forEach((r, i) => {
        // Whole in the window, and whole inside every part above it that clips or scrolls what it holds.
        if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) return;
        for (let a = el.parentElement; a; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
          const ar = a.getBoundingClientRect();
          if (r.left < ar.left - 0.5 || r.right > ar.right + 0.5 || r.top < ar.top - 0.5 || r.bottom > ar.bottom + 0.5) return;
        }
        // On top: from its top to its foot, at its middle and near both ends, the page's topmost part is the
        // words' own or one that holds them, so a line partly under a fixed header row is left out.
        const onTop = [r.top + 1, (r.top + r.bottom) / 2, r.bottom - 1].every((y) =>
          [r.left + 1, (r.left + r.right) / 2, r.right - 1].every((x) => {
            const hit = document.elementFromPoint(x, y);
            return hit !== null && (hit === el || el.contains(hit) || hit.contains(el));
          }));
        if (!onTop) return;
        out.push({
          text,
          role: roleOf(el),
          ...(off ? { inactive: true } : {}),
          line: i + 1,
          of: rows.length,
          box: [pct(r.left, vw), pct(r.top, vh), pct(r.right - r.left, vw), pct(r.bottom - r.top, vh)],
          px: parseFloat(cs.fontSize),
          ratio,
        });
      });
    }
    return out;
  }

  if (arg.op === 'targets') {
    const PRESS = 'button, a[href], select, textarea, summary, [role="option"], [role="menuitem"], [role="menuitemradio"], '
      + 'input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]), label:has(> input[type="radio"]), label:has(> input[type="checkbox"])';
    const out: Array<{ label: string; top: number; bottom: number; left: number; right: number; height: number; key: boolean }> = [];
    const seen = new Set<Element>();
    for (const found of Array.from(root.querySelectorAll(PRESS))) {
      if (!drawn(found, false)) continue;
      // A menu or a field drawn inside a key with its own edge is pressed through that key.
      const holder = found.parentElement?.closest('label');
      const el = holder && root.contains(holder) && edgedAllRound(getComputedStyle(holder)) ? holder : found;
      if (seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
      const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      out.push({
        label: describe(el, text),
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        height: r.height,
        key: !isField && el.getAttribute('role') !== 'option' && edgedAllRound(cs),
      });
    }
    return out;
  }

  if (arg.op === 'first') {
    const box = root.getBoundingClientRect();
    const top = box.top;
    const bottom = Math.min(box.top + arg.region, window.innerHeight);
    /** On the first screen: drawn inside the region, past every part above it that clips what it holds. */
    const onScreen = (el: Element, r: DOMRect): boolean => {
      let left = r.left;
      let right = r.right;
      let t = Math.max(r.top, top);
      let b = Math.min(r.bottom, bottom);
      for (let a = el === root ? null : el.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
          const ar = a.getBoundingClientRect();
          left = Math.max(left, ar.left);
          right = Math.min(right, ar.right);
          t = Math.max(t, ar.top);
          b = Math.min(b, ar.bottom);
        }
        if (a === root) break;
      }
      return right - left > 0.5 && b - t > 0.5;
    };
    const FOCUSABLE = 'a[href], button, select, textarea, summary, input:not([type="hidden"]), [tabindex], [contenteditable="true"]';
    const controls: string[] = [];
    const styles = new Map<string, string>();
    const boxes: string[] = [];
    const colours = new Map<string, string>();
    /** The lists whose rows part by one hairline each: the parting counts once a list. */
    const partedLists = new Set<Element>();
    const colour = (paint: string, where: string) => {
      const c = parse(paint);
      if (c[3] <= 0) return;
      const key = `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${r2(c[3])})`;
      if (!colours.has(key)) colours.set(key, `${key} ${where}`);
    };
    for (const el of parts()) {
      if (!visibleNow(el, false)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || !onScreen(el, r)) continue;
      const cs = getComputedStyle(el);
      const where = describe(el, '');
      if (el instanceof SVGElement) {
        if (el instanceof SVGGeometryElement) {
          if (cs.fill && cs.fill !== 'none' && !cs.fill.startsWith('url(')) colour(cs.fill, `fill of ${where}`);
          if (cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0) colour(cs.stroke, `stroke of ${where}`);
        }
        continue;
      }
      const tabindex = el.getAttribute('tabindex');
      const disabled = (el as HTMLButtonElement).disabled === true;
      if (el.matches(FOCUSABLE) && tabindex !== '-1' && !disabled && el.closest('[inert]') === null) {
        controls.push(describe(el, (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()));
      }
      const text = ownText(el);
      if (text && r.width > 1 && r.height > 1) {
        // A character with no letter or digit (the look key's sun or moon, a dot between words) is a glyph, not a style of words.
        if (/[\p{L}\p{N}]/u.test(text)) {
          const style = `${cs.fontFamily.split(',')[0].replace(/["']/g, '').trim()} ${cs.fontSize} ${cs.fontWeight}${cs.fontStyle === 'normal' ? '' : ` ${cs.fontStyle}`}`;
          if (!styles.has(style)) styles.set(style, `${style}: ${describe(el, text)}`);
        }
        colour(cs.color, `text of ${describe(el, text)}`);
      }
      const edges = edgesOf(cs);
      const bg = parse(cs.backgroundColor);
      for (const edge of edges) colour(edge, `edge of ${where}`);
      if (bg[3] > 0) colour(cs.backgroundColor, `ground of ${where}`);
      const ring = outlineOf(cs);
      if (ring) colour(ring, `outline of ${where}`);
      // A rule or a box: a part drawn with an edge or a ground of its own. The surface's own ground is the screen's,
      // and the drawings a screen reader skips (the line, its cells, the marks) are pictures, not boxes.
      const picture = el.closest('[aria-hidden="true"]') !== null;
      // Rows that part by one hairline each (DECISIONS.md rules 33 and 57) draw one rule for their list, not a box a row.
      const parting = (el.tagName === 'LI' || el.getAttribute('role') === 'listitem')
        && edges.length === 1 && bg[3] === 0 && cs.backgroundImage === 'none' && el.parentElement !== null;
      if (parting) {
        if (!picture && !partedLists.has(el.parentElement!)) {
          partedLists.add(el.parentElement!);
          boxes.push(`${where}, with the hairline parting each row of its list`);
        }
      } else if (el !== root && !picture && (edges.length > 0 || bg[3] > 0 || cs.backgroundImage !== 'none')) boxes.push(where);
      for (const which of ['::before', '::after'] as const) {
        const ps = getComputedStyle(el, which);
        if (!pseudoDrawn(ps)) continue;
        const pEdges = edgesOf(ps);
        const pBg = parse(ps.backgroundColor);
        for (const edge of pEdges) colour(edge, `edge of ${where}${which}`);
        if (pBg[3] > 0) colour(ps.backgroundColor, `ground of ${where}${which}`);
        if (!picture && (pEdges.length > 0 || pBg[3] > 0)) boxes.push(`${where}${which}`);
      }
    }
    return {
      controls: controls.length,
      textStyles: styles.size,
      rulesAndBoxes: boxes.length,
      colours: colours.size,
      detail: { controls, textStyles: [...styles.values()], rulesAndBoxes: boxes, colours: [...colours.values()] },
    };
  }

  if (arg.op === 'rows') {
    const box = root.getBoundingClientRect();
    return arg.rows.map((selector) => {
      const row = root.querySelector(selector);
      if (!row || !drawn(row, false)) return { row: selector, found: false, parts: 0, oneRow: false, inside: false, scroll: 0 };
      const shown = Array.from(row.children).filter((child) => {
        const r = child.getBoundingClientRect();
        return getComputedStyle(child).display !== 'none' && r.width > 0 && r.height > 0;
      }).map((child) => child.getBoundingClientRect());
      const lowestTop = Math.max(...shown.map((r) => r.top));
      const highestBottom = Math.min(...shown.map((r) => r.bottom));
      return {
        row: selector,
        found: true,
        parts: shown.length,
        oneRow: shown.length <= 1 || lowestTop < highestBottom,
        inside: shown.every((r) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5),
        scroll: row.scrollWidth - row.clientWidth,
      };
    });
  }

  // spacing: every word drawn whole, and none drawn over another word or another control.
  const cut: string[] = [];
  const overlaps: string[] = [];
  const words = parts().filter((el) => !field(el) && ownText(el) !== '' && drawn(el));
  const clips = (value: string): boolean => value === 'hidden' || value === 'clip';
  const meets = (p: DOMRect, q: DOMRect): boolean =>
    Math.min(p.right, q.right) - Math.max(p.left, q.left) > 2 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 2;
  const lines = words.map((el) => ({ el, text: ownText(el), rects: drawnWords(el) }));
  for (const { el, text, rects } of lines) {
    // Cut: a part that clips what it holds, the word's own included, hides some of its words, or an ellipsis stands for them.
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' && cs.display !== 'inline' && el.scrollWidth > el.clientWidth + 1) cut.push(`${describe(el, text)} ends in an ellipsis`);
    for (let a: Element | null = el; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      const ar = a.getBoundingClientRect();
      const left = ar.left + a.clientLeft;
      const top = ar.top + a.clientTop;
      const right = left + (a.clientWidth || ar.width);
      const bottom = top + (a.clientHeight || ar.height);
      if (clips(s.overflowX) && rects.some((r) => r.left < left - 1 || r.right > right + 1)) cut.push(`${describe(el, text)} is cut at the side by ${describe(a, '')}`);
      if (clips(s.overflowY) && rects.some((r) => r.top < top - 1 || r.bottom > bottom + 1)) cut.push(`${describe(el, text)} is cut at the top or foot by ${describe(a, '')}`);
      if (a === root) break;
    }
  }
  // Over another: a word's lines meet another part's words, or the box of a control that does not hold them.
  const PRESS = 'button, a[href], select, input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]), textarea, summary, label:has(> input), label:has(> select)';
  const controls = Array.from(root.querySelectorAll(PRESS)).filter((c) => drawn(c, false));
  for (let i = 0; i < lines.length; i += 1) {
    const a = lines[i];
    for (let j = i + 1; j < lines.length; j += 1) {
      const b = lines[j];
      if (a.rects.some((p) => b.rects.some((q) => meets(p, q)))) overlaps.push(`${describe(a.el, a.text)} over ${describe(b.el, b.text)}`);
    }
    const holder = a.el.closest(PRESS);
    for (const c of controls) {
      if (c.contains(a.el) || (holder && (holder === c || holder.contains(c)))) continue;
      const box = c.getBoundingClientRect();
      if (a.rects.some((p) => meets(p, box))) overlaps.push(`${describe(a.el, a.text)} over ${describe(c, (c.getAttribute('aria-label') ?? c.textContent ?? '').replace(/\s+/g, ' ').trim())}`);
    }
  }
  return { cut: [...new Set(cut)], overlaps: [...new Set(overlaps)] };
}

const read = <T>(root: Locator, arg: Partial<ReadArg> & { op: Op }): Promise<T> =>
  root.evaluate(readSurface, { region: 900, rows: [], ...arg }) as Promise<T>;

/** Waits until every finite animation of a surface has finished and the page has painted twice since. */
export async function settle(root: Locator): Promise<void> {
  await root.evaluate(async (el) => {
    const running = el.getAnimations({ subtree: true })
      .filter((a) => a.playState === 'running' && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)));
    // A running animation ends within its own time; two seconds bounds the wait all the same.
    await Promise.race([
      Promise.all(running.map((a) => a.finished.catch(() => undefined))),
      new Promise<void>((resolve) => { window.setTimeout(resolve, 2000); }),
    ]);
    await new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); });
  });
}

/** Every element with its own text: its role, size and contrast against the ground it is drawn on. */
export async function measureText(_page: Page, root: Locator): Promise<TextMeasure[]> {
  return read<TextMeasure[]>(root, { op: 'text' });
}

/** The glyphs ([aria-hidden] svg), the cells, bands, side marks and tracks, and the key and field edges, each against its ground. */
export async function measureGlyphs(_page: Page, root: Locator): Promise<GlyphMeasure[]> {
  return read<GlyphMeasure[]>(root, { op: 'glyphs' });
}

/**
 * The first screen's counts inside the surface's first 900 px, clipped to
 * what its scroll areas show: the focusable elements; the distinct computed
 * text styles (face, size, weight) of words, a character with no letter or
 * digit being a glyph; the elements with a visible edge or a ground of their
 * own, where the drawings a screen reader skips are pictures, not boxes, and
 * the hairlines that part a list's rows (DECISIONS.md rules 33 and 57) are
 * one rule for the list, as the designer counted the designed screen; and
 * the distinct computed colours (text, grounds, edges, outlines and the
 * drawings' paints, the surface's own included).
 */
export async function firstScreen(_page: Page, root: Locator): Promise<FirstScreen> {
  return read<FirstScreen>(root, { op: 'first', region: 900 });
}

/** Every control a person presses in the surface, a field or menu inside a key measured as that key. */
export async function measureTargets(_page: Page, root: Locator): Promise<Target[]> {
  return read<Target[]>(root, { op: 'targets' });
}

/** Each header row or row of keys the selectors name: found, one row, inside the surface, and not wider than itself. */
export async function keyRows(root: Locator, rows: string[]): Promise<KeyRow[]> {
  return read<KeyRow[]>(root, { op: 'rows', rows });
}

/**
 * With the text spacing applied: each word a clipping part cuts or an
 * ellipsis stands for, and each word drawn over another word or over a
 * control that does not hold it, read from where its text is drawn.
 */
export async function spacingFaults(root: Locator): Promise<{ cut: string[]; overlaps: string[] }> {
  return read<{ cut: string[]; overlaps: string[] }>(root, { op: 'spacing' });
}

/**
 * Each line of words a picture of the window shows now, inside one surface:
 * drawn whole in the window, with no part over it. A field's or a menu's own
 * value is left out, since its words are not text of the page.
 */
export async function wordBoxes(root: Locator): Promise<WordBox[]> {
  return read<WordBox[]>(root, { op: 'words' });
}

/**
 * The words under their figures: body and headings under 12:1, other words
 * under 7:1, words on an inactive key under 4.5:1; body text and headings
 * under 18 px, other words under 15 px, line numbers under 14 px, anything
 * under 14 px.
 */
export function failures(m: TextMeasure[]): TextMeasure[] {
  return m.filter((t) => {
    const ratio = round2(t.ratio);
    const minRatio = t.inactive ? FIGURES.glyphRatio : t.role === 'body' || t.role === 'heading' ? FIGURES.bodyRatio : FIGURES.otherRatio;
    const minPx = t.role === 'body' || t.role === 'heading' ? FIGURES.bodyPx : t.role === 'lineNumber' ? FIGURES.lineNumberPx : FIGURES.otherPx;
    return ratio < minRatio || t.px < minPx || t.px < FIGURES.smallestPx;
  });
}

/** A word under its figure, in one line: role, size, contrast and where. */
export const saidOf = (t: TextMeasure): string =>
  `${t.inactive ? 'inactive ' : ''}${t.role} ${t.px}px ${round2(t.ratio)}:1 ${t.selector}`;

/**
 * The controls under their size: below 900 px each one 44 px tall or more;
 * from 900 px each key 32 px tall or more, 8 px or more from the next key on
 * its row.
 */
export function targetFailures(targets: Target[], width: number): string[] {
  const out: string[] = [];
  if (width < FIGURES.desktopFrom) {
    for (const t of targets) {
      if (round2(t.height) < FIGURES.phoneTarget) out.push(`${t.label}: ${round2(t.height)} px tall, under ${FIGURES.phoneTarget}`);
    }
    return out;
  }
  const keys = targets.filter((t) => t.key);
  for (const k of keys) {
    if (round2(k.height) < FIGURES.desktopKey) out.push(`${k.label}: ${round2(k.height)} px tall, under ${FIGURES.desktopKey}`);
    const sameRow = (o: Target) => Math.min(k.bottom, o.bottom) - Math.max(k.top, o.top) > Math.min(k.height, o.height) / 2;
    const next = keys
      .filter((o) => o !== k && sameRow(o) && o.left >= k.right - 0.5)
      .sort((a, b) => a.left - b.left)[0];
    if (next && round2(next.left - k.right) < FIGURES.desktopGap) {
      out.push(`${k.label} and ${next.label}: ${round2(next.left - k.right)} px apart, under ${FIGURES.desktopGap}`);
    }
  }
  return out;
}
