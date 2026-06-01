/**
 * Pure renderer functions for the files emitted by `paracosm init`.
 * Each function takes a small input record and returns the file contents
 * as a string. No I/O, no dependencies on the caller's environment.
 *
 * Kept separate from init.ts so the renderers snapshot-test trivially.
 *
 * @module paracosm/cli/init-templates
 */

export interface PackageJsonInput {
  name: string;
  paracosmVersion: string;
}

export function renderPackageJson(input: PackageJsonInput): string {
  const pkg = {
    name: input.name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      start: 'node run.mjs',
    },
    dependencies: {
      paracosm: `^${input.paracosmVersion}`,
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

export type SimulationMode = 'turn-loop' | 'batch-trajectory' | 'batch-point';

/**
 * Render the entry script for a paracosm-init scaffolded project.
 *
 * The script imports `WorldModel` from `paracosm` (v0.9 root export)
 * and runs the actor at index 0 against a turn-loop simulation. Mode
 * is intentionally NOT a runtime input: it is a property of the
 * produced `RunArtifact.metadata`, surfaced after the run completes.
 * Batch-trajectory and batch-point modes are produced by `wm.batch`
 * (different config shape); a future spec adds a separate
 * `renderRunMjsBatch` for those modes.
 */
export function renderRunMjs(): string {
  return `#!/usr/bin/env node
/**
 * Entry script for a paracosm-init scaffolded project.
 *
 * Reads scenario.json + actors.json from this directory, runs the
 * configured actor at index 0, and prints the resulting RunArtifact JSON.
 * Edit the actor index, maxTurns, or seed below to explore.
 *
 * The "mode" of the resulting run lives on artifact.metadata.mode and is
 * always "turn-loop" for runs produced by wm.simulate. For
 * batch-trajectory or batch-point modes, use wm.batch directly.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldModel } from 'paracosm';

const here = dirname(fileURLToPath(import.meta.url));
const scenario = JSON.parse(readFileSync(resolve(here, 'scenario.json'), 'utf-8'));
const actors = JSON.parse(readFileSync(resolve(here, 'actors.json'), 'utf-8'));

if (!Array.isArray(actors) || actors.length === 0) {
  console.error('actors.json is empty. Re-run \\\`paracosm init\\\` to regenerate.');
  process.exit(1);
}

const wm = WorldModel.fromScenario(scenario);

const result = await wm.simulate({
  actor: actors[0],
  maxTurns: 6,
  seed: 42,
});

console.log(JSON.stringify(result, null, 2));
`;
}

export interface ReadmeInput {
  name: string;
  domain: string;
  mode: SimulationMode;
  actors: number;
}

export function renderReadme(input: ReadmeInput): string {
  return `# ${input.name}

Scaffolded by \`paracosm init\` from the seed:

> ${input.domain.slice(0, 200)}${input.domain.length > 200 ? '...' : ''}

This project contains:

- \`scenario.json\`: compiled \`ScenarioPackage\` (LLM-generated at init time)
- \`actors.json\`: ${input.actors} HEXACO actor configs (LLM-generated)
- \`run.mjs\`: minimal entry script that runs actor 0 in \`${input.mode}\` mode

## Quickstart

\`\`\`bash
npm install
cp .env.example .env
# Set OPENAI_API_KEY (and any other provider keys you need) in .env
node run.mjs
\`\`\`

## Customizing

- Edit \`scenario.json\` to tweak departments, world state, events.
- Edit \`actors.json\` to swap HEXACO traits or instructions.
- Edit \`run.mjs\` to change the actor index, mode, turn count, or seed.

See https://github.com/framerslab/paracosm for the full API reference.
`;
}

export function renderEnvExample(): string {
  return `# Required for compileScenario / generateText / generateObject calls.
OPENAI_API_KEY=

# Optional alternate providers paracosm can route to.
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

# Optional Cohere rerank for higher-accuracy retrieval.
COHERE_API_KEY=
`;
}

export function renderGitignore(): string {
  return `node_modules/
.env
.paracosm/
dist/
*.log
.DS_Store
`;
}

/**
 * Slug-normalize a project name. Lowercase ASCII, dashes between words,
 * strips everything else, max 50 chars. If empty after stripping,
 * returns 'paracosm-app'.
 */
export function slugifyName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return slug || 'paracosm-app';
}
