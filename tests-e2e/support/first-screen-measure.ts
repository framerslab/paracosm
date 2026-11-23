/**
 * The Run tab's first screen measured on the built page: every word and
 * glyph against its figure, every row that must stay one row, and the
 * automated WCAG 2.2 A and AA check.
 *
 * The words and glyphs are read by readability.ts, the measure the forged
 * tool view's spec uses, so both screens are held to the figures the same
 * way. A component marks its body text and headings with data-text="body"
 * or data-text="heading" (readability.ts's marks); every other word is
 * held to the figure for other words. The first screen's figures are
 * readability.ts's, with nothing under 15 px, and three named exceptions:
 * the label on the filled primary key (data-read-exception="primary-key-label")
 * is held at its key's fixed fill and never under 4.5 to 1, the wordmark's
 * second half (data-read-exception="wordmark") is a logotype outside the
 * figures, and JetBrains Mono on the short capital marks is a face, which
 * no figure here reads.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { FIGURES, measureGlyphs, measureText, saidOf, settle, type TextMeasure } from './readability.js';

/** The root of the Run tab's first screen. */
export const FIRST_SCREEN = '[data-testid="run-first-screen"]';

/** Nothing on the first screen is under 15 px (FEATURES.md, Readability: smallest). */
const SMALLEST_PX = 15;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The figure a word is held to, or null for a word outside the figures. */
function shortOf(t: TextMeasure): string | null {
  if (t.selector.includes('[data-read-exception="wordmark"]')) return null;
  const ratio = round2(t.ratio);
  if (t.selector.includes('[data-read-exception="primary-key-label"]')) {
    return ratio < FIGURES.glyphRatio ? `under ${FIGURES.glyphRatio}:1` : null;
  }
  const minRatio = t.inactive ? FIGURES.glyphRatio : t.role === 'body' || t.role === 'heading' ? FIGURES.bodyRatio : FIGURES.otherRatio;
  const minPx = t.role === 'body' || t.role === 'heading' ? FIGURES.bodyPx : Math.max(FIGURES.otherPx, SMALLEST_PX);
  const faults: string[] = [];
  if (ratio < minRatio) faults.push(`under ${minRatio}:1`);
  if (t.px < minPx) faults.push(`under ${minPx} px`);
  return faults.length ? faults.join(' and ') : null;
}

/**
 * One line for each word, glyph or edge under its figure inside the root:
 * body text and headings 12 to 1 and 18 px, other words 7 to 1 and 15 px,
 * glyphs and the edges of keys, fields and tracks 4.5 to 1. Empty when the
 * screen meets every figure.
 */
export async function measureReadability(page: Page, root = FIRST_SCREEN): Promise<string[]> {
  const surface = page.locator(root);
  await settle(surface);
  const out: string[] = [];
  for (const t of await measureText(page, surface)) {
    const fault = shortOf(t);
    if (fault) out.push(`${fault}: ${saidOf(t)}`);
  }
  for (const g of await measureGlyphs(page, surface)) {
    if (round2(g.ratio) < FIGURES.glyphRatio) out.push(`under ${FIGURES.glyphRatio}:1: ${g.ratio}:1 ${g.selector}`);
  }
  return out;
}

/**
 * Each [data-row] whose children do not stand on one row: a row holds when
 * every drawn child shares one horizontal band (each child's top lies above
 * every other child's bottom, less 2 px), so children of different heights
 * on one row pass and a child wrapped under another fails.
 */
export async function rowsOnOneRow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const row of Array.from(document.querySelectorAll('[data-row]'))) {
      const style = getComputedStyle(row);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const boxes = Array.from(row.children)
        .map((child) => child.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      if (boxes.length < 2) continue;
      const lowestTop = Math.max(...boxes.map((r) => r.top));
      const highestBottom = Math.min(...boxes.map((r) => r.bottom));
      if (lowestTop > highestBottom - 2) {
        const name = row.getAttribute('data-row') || row.getAttribute('aria-label') || row.textContent?.trim().slice(0, 40) || row.tagName;
        out.push(`${name}: its children stand on more than one row (${Math.round(lowestTop - highestBottom)} px apart)`);
      }
    }
    return out;
  });
}

/** WCAG 2.2 A and AA violations inside the root, one line each: the rule and the parts it names. */
export async function axeFindings(page: Page, root = FIRST_SCREEN): Promise<string[]> {
  const result = await new AxeBuilder({ page })
    .include(root)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .analyze();
  return result.violations.map((v) => `${v.id} (${v.impact ?? 'no impact'}): ${v.help} at ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
