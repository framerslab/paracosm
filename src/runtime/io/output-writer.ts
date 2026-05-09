/**
 * Run-output file writer.
 *
 * Extracted from orchestrator.ts so the end-of-run side-effect (JSON
 * snapshot to disk + summary log line) lives separately from the
 * turn-loop coordinator. Pure function over its inputs; returns the
 * absolute path it wrote to so the caller can log or surface it.
 *
 * @module paracosm/runtime/io/output-writer
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RunArtifact } from '../../engine/schema/index.js';

/**
 * Resolve the output directory to write run snapshots into.
 *
 * Priority order:
 *   1. `PARACOSM_OUTPUT_DIR` env var — absolute or cwd-relative, lets
 *      hosting / CI write outside the project tree without a code change.
 *   2. `<cwd>/output` — the user's current working directory when they
 *      invoked the process. This is the right default both for the
 *      in-repo CLI (`npm run smoke` from the paracosm repo root writes
 *      to `<repo>/output`) AND for library consumers (`bun src/index.ts`
 *      from their project root writes to `<their project>/output`).
 *
 * The previous default resolved `output/` relative to the installed
 * module location (`__dirname/../..`). That landed inside the package
 * install directory — fine during local development of paracosm itself,
 * but on any downstream consumer it wrote to
 * `node_modules/paracosm/output/` (or worse, a pnpm virtual-store path
 * like `node_modules/.pnpm/paracosm@x.y.z_hash/node_modules/paracosm/output/`),
 * which is impossible to find, invisible to git, and gets nuked on
 * `rm -rf node_modules`.
 */
function resolveOutputDir(): string {
  const override = process.env.PARACOSM_OUTPUT_DIR;
  if (override && override.trim().length > 0) {
    return resolve(process.cwd(), override);
  }
  return resolve(process.cwd(), 'output');
}

/**
 * Write a simulation result payload to `<cwd>/output/v3-<tag>-<ts>.json`
 * (or `$PARACOSM_OUTPUT_DIR/...`) and log a one-screen summary to stdout.
 * Ensures the output dir exists before writing. Returns the absolute
 * path of the written file.
 *
 * The tag slot comes from the leader's archetype so side-by-side runs
 * get distinguishable filenames even when they start in the same
 * millisecond (e.g. `v3-the-engineer-...` vs `v3-the-visionary-...`).
 */
export function writeRunOutput(
  output: RunArtifact,
  args: {
    actorName: string;
    actorArchetype: string;
    turns: number;
    toolRegs: Record<string, string[]>;
  },
): string {
  const outDir = resolveOutputDir();
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = args.actorArchetype.toLowerCase().replace(/\s+/g, '-');
  const path = resolve(outDir, `v3-${tag}-${ts}.json`);
  writeFileSync(path, JSON.stringify(output, null, 2));

  const citations = output.citations?.length ?? 0;
  const tools = output.forgedTools?.length ?? 0;
  const pop = (output.finalState?.metrics?.population as number | undefined) ?? 0;
  const moralePct =
    output.finalState?.metrics?.morale != null
      ? Math.round(Number(output.finalState.metrics.morale) * 100)
      : 0;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  COMPLETE — ${args.actorName}`);
  console.log(`  Output: ${path}`);
  console.log(`  Turns: ${args.turns} | Citations: ${citations} | Tools: ${tools}`);
  console.log(`  Final: Pop ${pop} | Morale ${moralePct}%`);
  console.log(`  Registries: ${JSON.stringify(args.toolRegs)}`);
  console.log(`${'═'.repeat(60)}\n`);

  return path;
}
