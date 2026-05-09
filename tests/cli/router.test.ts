/**
 * Unit tests for the paracosm subcommand router. The router is a pure
 * dispatcher: no process.exit, no I/O beyond writing to stdout/stderr.
 * These tests stub stdout/stderr so the dispatch decision is the
 * observable.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../../src/server/router.js';

interface CapturedIO {
  stdout: string;
  stderr: string;
}

function captureIO(fn: () => Promise<unknown>): Promise<CapturedIO & { result: unknown }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stderr.write;
  return fn().then((result) => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    return { result, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
  }, (err) => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    throw err;
  });
}

describe('paracosm subcommand router', () => {
  describe('global flags', () => {
    it('--version prints "paracosm <semver>" and exits 0', async () => {
      const { result, stdout } = await captureIO(() => dispatch(['--version']));
      assert.deepEqual(result, { exitCode: 0 });
      assert.match(stdout, /^paracosm \d+\.\d+\.\d+/);
    });

    it('-v works the same', async () => {
      const { result, stdout } = await captureIO(() => dispatch(['-v']));
      assert.deepEqual(result, { exitCode: 0 });
      assert.match(stdout, /^paracosm /);
    });

    it('--help with no command prints top-level help', async () => {
      const { result, stdout } = await captureIO(() => dispatch(['--help']));
      assert.deepEqual(result, { exitCode: 0 });
      assert.match(stdout, /paracosm <command>/);
      assert.match(stdout, /run\b/);
      assert.match(stdout, /dashboard\b/);
      assert.match(stdout, /compile/);
      assert.match(stdout, /init/);
    });

    it('-h with no command prints top-level help', async () => {
      const { result, stdout } = await captureIO(() => dispatch(['-h']));
      assert.deepEqual(result, { exitCode: 0 });
      assert.match(stdout, /paracosm <command>/);
    });
  });

  describe('per-subcommand help', () => {
    it('paracosm run --help prints run-specific help', async () => {
      const { result, stdout } = await captureIO(() => dispatch(['run', '--help']));
      assert.deepEqual(result, { exitCode: 0 });
      assert.match(stdout, /paracosm run/);
      assert.match(stdout, /--actor/);
      assert.match(stdout, /--turns/);
    });

    it('paracosm dashboard -h prints dashboard help', async () => {
      const { result, stdout } = await captureIO(() => dispatch(['dashboard', '-h']));
      assert.deepEqual(result, { exitCode: 0 });
      assert.match(stdout, /paracosm dashboard/);
      assert.match(stdout, /3456/);
    });

    it('paracosm compile --help prints compile help', async () => {
      const { result, stdout } = await captureIO(() => dispatch(['compile', '--help']));
      assert.deepEqual(result, { exitCode: 0 });
      assert.match(stdout, /paracosm compile/);
      assert.match(stdout, /--seed-text/);
      assert.match(stdout, /--seed-url/);
    });

    it('paracosm init --help prints init help', async () => {
      const { result, stdout } = await captureIO(() => dispatch(['init', '--help']));
      assert.deepEqual(result, { exitCode: 0 });
      assert.match(stdout, /paracosm init/);
      assert.match(stdout, /--domain/);
    });

    it('paracosm help <command> works as alias for <command> --help', async () => {
      const { result, stdout } = await captureIO(() => dispatch(['help', 'run']));
      assert.deepEqual(result, { exitCode: 0 });
      assert.match(stdout, /paracosm run/);
    });
  });

  describe('no args', () => {
    it('paracosm with empty argv prints top-level help', async () => {
      const { result, stdout } = await captureIO(() => dispatch([]));
      assert.deepEqual(result, { exitCode: 0 });
      assert.match(stdout, /paracosm <command>/);
    });
  });

  describe('legacy back-compat', () => {
    it('bare `paracosm <flag>` triggers deprecation warning + dispatches to run', async () => {
      // Don't actually run the sim (it would call LLMs); we only need to
      // verify the deprecation wiring. We test by passing only flags
      // that would fail leader resolution in a temp cwd, but we check
      // the deprecation field separately. The real assertion is that
      // looksLikeLegacyRun returns true for these inputs and the
      // dispatch fall-through executes.
      // Here we use a recognized legacy flag without a value; runSim
      // will fail leader resolution and return exitCode 1, but the
      // `deprecation` field on the result must be set.
      const cwd = process.cwd();
      try {
        // Move to a directory with no leaders.json / config/leaders.json
        // so loadLeaders falls back to the bundled example. If the
        // bundle exists, runSim will try to launch a real sim; we stop
        // before that by passing an unparsable HEXACO override.
        process.chdir('/tmp');
        const { result } = await captureIO(() => dispatch(['--openness', 'NaN']));
        assert.equal(typeof (result as { exitCode: number }).exitCode, 'number');
        assert.match(
          (result as { deprecation?: string }).deprecation ?? '',
          /deprecated/,
        );
      } finally {
        process.chdir(cwd);
      }
    });

    it('positional integer alone (e.g. `paracosm 3`) triggers legacy fall-through', async () => {
      const cwd = process.cwd();
      try {
        process.chdir('/tmp');
        const { result } = await captureIO(() => dispatch(['3']));
        // exitCode may be 0 or 1 depending on bundled-example presence;
        // the contract under test is that `deprecation` is populated.
        assert.match(
          (result as { deprecation?: string }).deprecation ?? '',
          /deprecated/,
        );
      } finally {
        process.chdir(cwd);
      }
    });
  });

  describe('unknown command', () => {
    it('unknown subcommand prints help to stderr and exits 1', async () => {
      const { result, stderr, stdout } = await captureIO(() => dispatch(['frobnicate']));
      assert.deepEqual(result, { exitCode: 1 });
      assert.match(stderr, /Unknown command: frobnicate/);
      assert.match(stdout, /paracosm <command>/);
    });
  });
});
