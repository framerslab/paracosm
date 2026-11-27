/**
 * Type declarations for the npm-install-retry.mjs script, so the test at
 * tests/scripts/npm-install-retry.test.ts can import it.
 */
import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';

export function isUnservedTarball(stderr: string | null | undefined): boolean;

export interface NpmWithRetryOptions {
  cwd: string;
  tries?: number;
  waitMs?: number;
  run?: (command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => SpawnSyncReturns<string>;
  sleep?: (ms: number) => void;
  log?: (line: string) => void;
  writeStderr?: (text: string) => void;
}

export function npmWithRetry(args: string[], options: NpmWithRetryOptions): number;
