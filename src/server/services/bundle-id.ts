/**
 * UUIDs for grouping every run from one Quickstart submission. RunRecord
 * stores `bundleId` so the LIBRARY can collapse a bundle's members into
 * one card and the Compare view can fetch the bundle's runs in one query.
 *
 * @module paracosm/cli/server/bundle-id
 */
import { randomUUID } from 'node:crypto';

export const BUNDLE_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateBundleId(): string {
  return randomUUID();
}
