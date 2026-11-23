/**
 * Forges tools one after another on the engine a run builds, in a process
 * of its own, and prints how each forge ended and what the executor
 * answered for each of its test cases.
 *
 * tests/runtime/forged-code-quickjs.test.ts starts this file for forges
 * whose outcome includes "the process that forged goes on": a forge that
 * fills memory, made in the test's own process, could end the whole test run.
 *
 * The request is one JSON argument: `{ setup, forges }`. `setup` is a run's
 * setup as a request carries it; the engine is the one `createEmergentEngine`
 * builds with the execution settings `normalizeSimulationConfig` gives that
 * setup, as a run builds it. `forges` are forge requests, made in order on
 * that one engine. The judge is answered by the stub transport
 * (tests/runtime/helpers/stub-openai-transport.ts), so no network is reached;
 * it approves a forge only when every test case it reads ran
 * (`success=true`). Each forge prints one line, `{ ended, success, statuses }`,
 * where `statuses` are the executor's answers to the forge's test cases in
 * order. The last line, `settled`, is printed from a timer, so it is reached
 * only when nothing the forges left behind holds the process first.
 */
import type { ForgedCodeExecutor } from '@framers/agentos';
import { normalizeSimulationConfig } from '../../../src/cli/sim-config.js';
import { createEmergentEngine } from '../../../src/runtime/orchestrator/emergent-setup.js';
import { engineExecutor } from './engine-executor.js';
import { withStubOpenAi } from './stub-openai-transport.js';

interface ForgeSequenceRequest {
  setup: unknown;
  forges: Array<Record<string, unknown>>;
}

/** EmergentJudge's creation verdict, approving or rejecting. */
function verdict(approved: boolean): string {
  return JSON.stringify({
    safety: { passed: true, concerns: [] },
    correctness: { passed: approved, failedTests: [] },
    determinism: { likely: true, reasoning: '' },
    bounded: { likely: true, reasoning: '' },
    confidence: approved ? 0.9 : 0.1,
    approved,
    reasoning: approved ? 'Every test case ran.' : 'A test case did not run.',
  });
}

const request = JSON.parse(process.argv[2] ?? '{}') as ForgeSequenceRequest;

async function forgeInTurn(): Promise<void> {
  const config = normalizeSimulationConfig(request.setup as never);
  await withStubOpenAi(
    (sent) => verdict(!/success=false/.test(sent.text)),
    async () => {
      const { engine } = createEmergentEngine(
        new Map(), 'openai', 'gpt-4o', config.execution, undefined, undefined, undefined, 'placeholder-key-for-a-test',
      );
      const executor = engineExecutor(engine);
      let statuses: string[] = [];
      const run = executor.run.bind(executor);
      const observed: ForgedCodeExecutor['run'] = async (call) => {
        const answer = await run(call);
        statuses.push(answer.status);
        return answer;
      };
      Object.defineProperty(executor, 'run', { value: observed, configurable: true });

      for (const forge of request.forges) {
        statuses = [];
        let line: Record<string, unknown>;
        try {
          const result = await engine.forge(forge as never, { agentId: 'dept-test', sessionId: 'sess-test' });
          line = { ended: 'returned', success: result.success, statuses };
        } catch (err: unknown) {
          line = { ended: 'threw', message: err instanceof Error ? err.message : 'a value that is not an Error', statuses };
        }
        process.stdout.write(`${JSON.stringify(line)}\n`);
      }
    },
  );
}

forgeInTurn().then(
  () => {
    setTimeout(() => {
      process.stdout.write('settled\n');
    }, 50);
  },
  (err: unknown) => {
    process.stdout.write(`${JSON.stringify({ ended: 'failed', message: err instanceof Error ? err.message : 'a value that is not an Error' })}\n`);
    process.exitCode = 1;
  },
);
