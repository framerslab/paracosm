/**
 * Type declarations for the npm-install-retry.mjs script, so the test at
 * tests/scripts/npm-install-retry.test.ts can import it.
 */
/** Whether npm's error summary reports a public registry tarball E404. */
export function isUnservedTarball(stderr: string | null | undefined): boolean;

/** Configure an npm install and its retry behavior. */
export interface NpmWithRetryOptions {
  /** Directory in which to run npm. */
  cwd: string;
  /** Total attempts, including the first. Defaults to five. */
  tries?: number;
  /** Time between attempts in milliseconds. Defaults to 30,000. */
  waitMs?: number;
  /** Override the npm process runner. Forward stderr before returning its exit status. */
  run?: (
    args: string[],
    cwd: string,
    onStderr: (text: string) => void,
  ) => Promise<{ status: number | null; signal: NodeJS.Signals | null }>;
  /** Override the wait between attempts. */
  sleep?: (ms: number) => void | Promise<void>;
  /** Override where retry notices are written. */
  log?: (line: string) => void;
  /** Override where npm's stderr chunks are written. */
  writeStderr?: (text: string) => void;
}

/** Resolve to the successful attempt number or reject on a terminal npm failure. */
export function npmWithRetry(args: string[], options: NpmWithRetryOptions): Promise<number>;
