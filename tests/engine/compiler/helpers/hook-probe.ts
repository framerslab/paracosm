/**
 * Runs one hook call in a process of its own and prints how it ended.
 *
 * tests/engine/compiler/hook-own-context.test.ts starts this file for the
 * calls whose outcome is "the process that made the call goes on": a call
 * made in the test's own process could hold or stop the whole test run.
 *
 * The request is one JSON argument: `{ kind: 'arrow', code, args }` runs
 * `runArrowSync`, `{ kind: 'progression', code, ctx }` runs
 * `runProgressionSync`. The first line printed says how the call ended.
 * The second line, `settled`, is printed from a timer, so it is reached
 * only when nothing the call left behind holds or ends the process first.
 */
import { runArrowSync, runProgressionSync, SandboxRunnerError } from '../../../../src/engine/compiler/sandbox-runner.js';

interface ProbeRequest {
  kind: 'arrow' | 'progression';
  code: string;
  args?: unknown[];
  ctx?: { agents: Array<Record<string, unknown>>; [k: string]: unknown };
}

const request = JSON.parse(process.argv[2] ?? '{}') as ProbeRequest;

let line: Record<string, unknown>;
try {
  if (request.kind === 'progression') {
    const ctx = request.ctx ?? { agents: [] };
    runProgressionSync(request.code, ctx);
    line = { ended: 'returned', type: 'undefined' };
  } else {
    const value = runArrowSync<unknown[], unknown>(request.code, request.args ?? []);
    line = { ended: 'returned', type: typeof value };
  }
} catch (err) {
  line = {
    ended: 'threw',
    sandbox: err instanceof SandboxRunnerError,
    message: err instanceof Error ? err.message : 'a value that is not an Error',
  };
}
process.stdout.write(`${JSON.stringify(line)}\n`);
setTimeout(() => {
  process.stdout.write('settled\n');
}, 50);
