/**
 * `npm install` and `npm ci` with a retry for one failure: the registry lists a version whose
 * tarball it does not serve yet. A dependency published moments before an install answers that way
 * for a minute or two: release run 46031084476 installed resend 6.41.0 84 seconds after it was
 * published, and its tarball answered 404. npm retries network errors and 5xx answers but not a
 * 404, so the command runs again, `waitMs` apart and at most `tries` times in all, while its error
 * is that 404. Any other failure is thrown at once.
 */
import { spawnSync } from 'node:child_process';

/** npm's line for a tarball it asked the registry for and was not served: GET https://registry.npmjs.org/<name>/-/<file>.tgz. */
const UNSERVED_TARBALL = /^npm (?:error|ERR!) 404 Not Found - GET https:\/\/registry\.npmjs\.org\/\S+\/-\/\S+\.tgz\b/m;

/** True when npm's error output says the registry did not serve the tarball of a version it lists. */
export function isUnservedTarball(stderr) {
  return UNSERVED_TARBALL.test(String(stderr ?? ''));
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs `npm <args>` in `cwd`, its standard output on this process's and its error output copied to
 * this process's. Returns the try that succeeded; throws when npm fails for any other reason, or
 * when the tarball is still not served at the last try.
 */
export function npmWithRetry(
  args,
  {
    cwd,
    tries = 5,
    waitMs = 30_000,
    run = spawnSync,
    sleep = sleepSync,
    log = (line) => console.log(line),
    writeStderr = (text) => process.stderr.write(text),
  },
) {
  for (let attempt = 1; ; attempt += 1) {
    const result = run('npm', args, { cwd, stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const stderr = String(result.stderr ?? '');
    if (stderr) writeStderr(stderr);
    if (result.error) throw result.error;
    if (result.status === 0) return attempt;
    const ended = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    const failure = new Error(`Command failed: npm ${args.join(' ')} (${ended})`);
    if (attempt >= tries || !isUnservedTarball(stderr)) throw failure;
    log(
      `npm ${args[0]}: the registry does not serve a tarball it lists yet (try ${attempt} of ${tries}); ` +
        `running it again in ${Math.round(waitMs / 1000)} s`,
    );
    sleep(waitMs);
  }
}
