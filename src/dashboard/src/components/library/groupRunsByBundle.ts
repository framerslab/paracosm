/**
 * Group a flat list of RunRecords into either solo entries (no bundleId)
 * or bundle entries (multiple records sharing a bundleId). Used by
 * RunGallery to render BundleCard for grouped + RunCard for solo.
 *
 * @module paracosm/dashboard/library/groupRunsByBundle
 */
import type { RunRecord } from '../../../../server/services/run-record.js';

export type GalleryEntry =
  | { kind: 'solo'; record: RunRecord }
  | {
      kind: 'bundle';
      bundleId: string;
      scenarioId: string;
      memberCount: number;
      totalCostUSD: number;
      earliestCreatedAt: string;
      members: RunRecord[];
    };

export function groupRunsByBundle(records: RunRecord[]): GalleryEntry[] {
  const buckets = new Map<string, RunRecord[]>();
  const solos: RunRecord[] = [];
  for (const r of records) {
    if (r.bundleId) {
      const arr = buckets.get(r.bundleId) ?? [];
      arr.push(r);
      buckets.set(r.bundleId, arr);
    } else {
      solos.push(r);
    }
  }
  const entries: GalleryEntry[] = [];
  for (const [bundleId, members] of buckets) {
    members.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    entries.push({
      kind: 'bundle',
      bundleId,
      scenarioId: members[0].scenarioId,
      memberCount: members.length,
      totalCostUSD: members.reduce((s, m) => s + (m.costUSD ?? 0), 0),
      earliestCreatedAt: members[0].createdAt,
      members,
    });
  }
  for (const r of solos) {
    entries.push({ kind: 'solo', record: r });
  }
  // Sort entries by createdAt ascending so chronological scan reads
  // oldest -> newest. The gallery may reverse for display.
  entries.sort((a, b) => {
    const aT = a.kind === 'solo' ? a.record.createdAt : a.earliestCreatedAt;
    const bT = b.kind === 'solo' ? b.record.createdAt : b.earliestCreatedAt;
    return aT.localeCompare(bT);
  });
  return entries;
}
