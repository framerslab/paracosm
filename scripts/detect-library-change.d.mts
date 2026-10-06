/**
 * Type declarations for the detect-library-change.mjs script, so the
 * test at tests/scripts/detect-library-change.test.ts can import it.
 */
export function shipsInPackage(file: string, shippedPaths: string[]): boolean;
export function changesPackage(changedFiles: string[], shippedPaths: string[]): boolean;
export function main(): void;
