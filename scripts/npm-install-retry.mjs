/**
 * `npm install` and `npm ci` with a retry for one failure: the registry lists a version whose
 * tarball it does not serve yet. A dependency published moments before an install answers that way
 * for a minute or two: release run 46031084476 installed resend 6.41.0 84 seconds after it was
 * published, and its tarball answered 404. npm retries network errors and 5xx answers but not a
 * 404, so the command runs again, `waitMs` apart and at most `tries` times in all, while its error
 * is that 404. Any other failure is thrown at once.
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';

/** npm's line for a tarball it asked the registry for and was not served: GET https://registry.npmjs.org/<name>/-/<file>.tgz. */
const UNSERVED_TARBALL = /^npm (?:error|ERR!) 404 Not Found - GET https:\/\/registry\.npmjs\.org\/\S+\/-\/[^/\s]+\.tgz(?:\s|$)/;
const ERROR_CODE = /^npm (?:error|ERR!) code (\S+)$/;
const COMMAND_FAILED = /^npm (?:error|ERR!) command failed$/;

/** Read npm's error summary a line at a time without retaining the diagnostic stream. */
function tarballCheck() {
  let pending = '';
  let sawE404 = false;
  let matched = false;
  let commandFailed = false;
  return {
    write(text) {
      const lines = text.split('\n');
      for (const [index, line] of lines.entries()) {
        // npm's summary URLs fit within this limit. Skip long diagnostic lines without cutting CI output.
        if (pending !== null) pending = pending.length + line.length <= 8192 ? pending + line : null;
        if (index === lines.length - 1) break;
        const message = pending === null ? '' : stripVTControlCharacters(pending).trimEnd();
        pending = '';
        commandFailed ||= COMMAND_FAILED.test(message);
        const code = ERROR_CODE.exec(message);
        if (code) matched = false;
        else if (sawE404) matched = UNSERVED_TARBALL.test(message);
        sawE404 = code?.[1] === 'E404';
      }
    },
    result() {
      this.write('\n');
      return matched && !commandFailed;
    },
  };
}

/** True when npm reports an E404 for a public registry tarball in its error summary. */
export function isUnservedTarball(stderr) {
  const check = tarballCheck();
  check.write(stderr ?? '');
  return check.result();
}

/** Inherit stdin and stdout, and forward decoded stderr as npm writes it. */
function runNpm(args, cwd, onStderr) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd, stdio: ['inherit', 'inherit', 'pipe'] });
    child.stderr.setEncoding('utf8').on('data', onStderr);
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal }));
  });
}

/**
 * Runs `npm <args>` in `cwd` with live output. Resolves to the successful attempt.
 * Rejects on startup errors, signals, other npm failures, or an exhausted retry budget.
 */
export async function npmWithRetry(
  args,
  {
    cwd,
    tries = 5,
    waitMs = 30_000,
    run = runNpm,
    sleep = delay,
    log = (line) => console.log(line),
    writeStderr = (text) => process.stderr.write(text),
  },
) {
  for (let attempt = 1; ; attempt += 1) {
    const check = tarballCheck();
    const { status, signal } = await run(args, cwd, (text) => {
      writeStderr(text);
      check.write(text);
    });
    if (status === 0) return attempt;
    const ended = signal ? ` (signal ${signal})` : '';
    const failure = new Error(`Command failed: npm ${args.join(' ')}${ended}`);
    if (signal || attempt >= tries || !check.result()) throw failure;
    log(
      `npm ${args[0]}: the registry does not serve a tarball it lists yet (try ${attempt} of ${tries}); ` +
        `running it again in ${Math.round(waitMs / 1000)} s`,
    );
    await sleep(waitMs);
  }
}
