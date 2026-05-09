/**
 * Flat, deduplicated citation catalog builder.
 *
 * Every department report in a run carries its own citations. The
 * catalog merges them by URL (falling back to text when no URL is
 * present) and tracks which departments + turns referenced each
 * citation, so the References section in reports can show
 * provenance across the whole run.
 *
 * Pure — takes the per-turn report list, returns a serialisable array.
 *
 * @module paracosm/runtime/io/citations-catalog
 */

import type { DepartmentReport } from '../contracts.js';

/** One row in the run's flat citation catalog. */
export interface CitationCatalogEntry {
  text: string;
  url: string;
  doi?: string;
  departments: string[];
  turns: number[];
}

/**
 * Build the canonical citation catalog from a run's department reports.
 * Dedup key is URL when present, else the citation text. DOI is
 * preserved from whichever occurrence first supplies it. Turn numbers
 * are sorted ascending in the output so consumers render a clean
 * chronological trail.
 */
export function buildCitationCatalog(
  allDepartmentReports: ReadonlyArray<{ turn: number; report: DepartmentReport }>,
): CitationCatalogEntry[] {
  const byKey = new Map<string, {
    text: string;
    url: string;
    doi?: string;
    departments: Set<string>;
    turns: Set<number>;
  }>();
  for (const { turn, report } of allDepartmentReports) {
    for (const c of report.citations) {
      const key = (c.url || '').trim() || `text:${(c.text || '').trim()}`;
      if (!key) continue;
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          text: c.text || c.url || '',
          url: c.url || '',
          doi: c.doi,
          departments: new Set(),
          turns: new Set(),
        };
        byKey.set(key, entry);
      }
      if (report.department) entry.departments.add(report.department);
      entry.turns.add(turn);
      if (!entry.doi && c.doi) entry.doi = c.doi;
    }
  }
  return [...byKey.values()].map(e => ({
    ...e,
    departments: [...e.departments],
    turns: [...e.turns].sort((a, b) => a - b),
  }));
}
