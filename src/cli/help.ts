/**
 * Help text for the paracosm CLI router. Single source of truth so
 * `paracosm --help`, `paracosm run --help`, etc. all stay in sync.
 *
 * @module paracosm/cli/help
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOP_LEVEL_HELP = `paracosm <command> [options]

A structured world model for AI agents. Compile prompts, briefs, URLs, or
JSON contracts into typed scenarios. Run HEXACO-personality actors against
a deterministic kernel.

Commands:
  run                   Run a simulation against actors.json
  dashboard             Start the SSE web dashboard at http://localhost:3456
  compile <scenario>    Compile a scenario draft into runnable hooks (cached)
  init <dir>            Scaffold a starter project from a free-text brief
  help [command]        Show help for a specific command
  version               Print version

Global flags:
  --help, -h            Show help (works on every subcommand)
  --version, -v         Print version

Examples:
  paracosm run                                            # default actor, full turns
  paracosm run --actor 1 --turns 5                        # actor index 1, 5 turns
  paracosm run --name "Reyes" --openness 0.85 6           # inline HEXACO override
  paracosm dashboard --turns 6                            # opens browser dashboard
  paracosm compile scenarios/lunar.json --seed-url <url>  # compile + cache
  paracosm init my-app --domain "Submarine crew of 8"     # scaffold a project

Docs:   https://paracosm.agentos.sh/docs
GitHub: https://github.com/framerslab/paracosm
`;

const RUN_HELP = `paracosm run [options]

Run a simulation against actors.json (or --actors <path>) and print
turn-by-turn narrative to stdout. Saves the full RunArtifact JSON to
./output/v3-<archetype>-<timestamp>.json (override with PARACOSM_OUTPUT_DIR).

Options:
  --actor <n>             Actor index in actors.json (default: 0)
  --actors <path>         Custom actors.json path
  --turns <n>             Override turn count
  --seed <n>              Override seed
  --start-time <n>        Override start time / year
  --provider <p>          openai | anthropic (defaults to whichever key is set)
  --cost <p>              quality | economy (default: quality)
  --live                  Enable live web search during department analysis
  --name <s>              Override actor name
  --archetype <s>         Override actor archetype
  --unit <s>              Override actor unit
  --instructions <s>      Override actor instructions
  --openness <0-1>        HEXACO openness override
  --conscientiousness <0-1>
  --extraversion <0-1>
  --agreeableness <0-1>
  --emotionality <0-1>
  --honesty <0-1>         HEXACO honesty-humility override

Positional turn count: a single trailing number is read as --turns
  paracosm run 5          # equivalent to: paracosm run --turns 5
`;

const DASHBOARD_HELP = `paracosm dashboard [turns] [options]

Start the SSE web dashboard at http://localhost:3456 (override with PORT).
The dashboard exposes the Setup, Reports, Library, Branches, Viz, and Chat
tabs over a streaming connection. Without [turns], waits for setup at
/sim?tab=settings; with [turns], auto-launches a simulation on boot.

Options:
  [turns]               Auto-launch with N turns. Omit to wait for setup.
  --actors <path>       Custom actors.json path
  --seed <n>            Override seed
  --start-time <n>      Override start time
  --provider <p>        openai | anthropic
  --live                Enable live web search

Environment:
  PORT                  Dashboard port (default: 3456)
  PARACOSM_ENABLE_SIMULATE_ENDPOINT=true   Enable POST /simulate one-shot endpoint
`;

const COMPILE_HELP = `paracosm compile <scenario.json> [options]

Compile a scenario JSON draft into a runnable ScenarioPackage with generated
TypeScript hooks. Caches per-hook on (scenario hash + model + schema version)
so re-runs hit disk. Cost: roughly $0.10 per first compile, free thereafter.

Options:
  <scenario.json>       Required: path to a scenario JSON draft
  --provider <p>        openai | anthropic (default: anthropic)
  --model <m>           Model name (default: claude-sonnet-4-6)
  --no-cache            Skip disk cache; force regeneration
  --cache-dir <dir>     Cache directory (default: .paracosm/cache)
  --seed-text <s>       Ground the scenario with an inline brief
  --seed-url <url>      Ground the scenario with a URL (Firecrawl extraction)
  --no-web-search       Skip live citation grounding during seed ingestion
  --max-searches <n>    Cap live grounding searches (default: 5)
`;

const INIT_HELP = `paracosm init <dir> --domain <text|url> [options]

Scaffold a runnable paracosm project from a free-text brief or a URL.
Calls compileFromSeed + generateQuickstartActors, then writes
package.json, run.mjs, README.md, .env.example, .gitignore to <dir>.

Options:
  <dir>                 Output directory (default: ./paracosm-app)
  --domain <text|url>   Required: seed text or URL describing the scenario
  --mode <m>            turn-loop | batch-trajectory | batch-point (default: turn-loop)
  --actors <n>          Number of HEXACO actors, 2-6 (default: 3)
  --name <s>            Project name (default: derived from --domain)
  --force               Overwrite a non-empty target directory

Example:
  paracosm init my-app --domain "Submarine crew of 8 in deep ocean for 30 days"
`;

const HELP_BY_COMMAND: Record<string, string> = {
  run: RUN_HELP,
  dashboard: DASHBOARD_HELP,
  compile: COMPILE_HELP,
  init: INIT_HELP,
};

/**
 * Print top-level help to stdout.
 */
export function printTopLevelHelp(): void {
  process.stdout.write(TOP_LEVEL_HELP);
}

/**
 * Print help for a specific subcommand. Falls back to top-level help when
 * the command is unknown.
 */
export function printCommandHelp(command: string): void {
  const text = HELP_BY_COMMAND[command];
  if (text) {
    process.stdout.write(text);
  } else {
    process.stdout.write(`Unknown command: ${command}\n\n`);
    process.stdout.write(TOP_LEVEL_HELP);
  }
}

/**
 * Read paracosm's own version from the package.json shipped with the
 * installed package. Looks two directories up from `dist/cli/help.js`
 * (the published location), and one directory up from
 * `src/cli/help.ts` (when running via tsx during development).
 */
export function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/cli/help.js -> dist/.. -> package root
  // src/cli/help.ts  -> src/..  -> package root
  const candidates = [
    resolve(here, '..', '..', 'package.json'),
    resolve(here, '..', 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { name?: string; version?: string };
      if (pkg.name === 'paracosm' && typeof pkg.version === 'string') {
        return pkg.version;
      }
    } catch {
      // Try next candidate.
    }
  }
  return 'unknown';
}
