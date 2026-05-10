/**
 * Subcommand dispatcher for `paracosm <command>`. Lives separately
 * from run.ts so it can be unit-tested without the binary's
 * process-exit path firing.
 *
 * Recognized subcommands:
 *   run, dashboard, compile, init, help, version
 *
 * Global flags `--help`/`-h` and `--version`/`-v` short-circuit at
 * any position before subcommand parsing.
 *
 * Back-compat path: when argv has neither a recognized subcommand nor
 * a global flag, dispatch falls through to `run` and the result carries
 * a one-line `deprecation` hint the binary surfaces to stderr.
 *
 * @module paracosm/cli/router
 */

import { printTopLevelHelp, printCommandHelp, readPackageVersion } from '../cli/help.js';

const KNOWN_COMMANDS = new Set([
  'run',
  'dashboard',
  'compile',
  'init',
  'help',
  'version',
]);

/**
 * Sim flags that the legacy `paracosm <flags>` (no subcommand) form
 * accepted. When any of these appear in argv with no subcommand, the
 * router falls through to `run` with a deprecation hint instead of
 * printing help and exiting.
 */
const LEGACY_RUN_FLAGS = new Set([
  '--leader', '--leaders', '--name', '--archetype', '--unit', '--instructions',
  '--openness', '--conscientiousness', '--extraversion', '--agreeableness',
  '--emotionality', '--honesty', '--turns', '--seed', '--start-time',
  '--provider', '--cost', '--live',
]);

export interface DispatchResult {
  /** Process exit code returned by the subcommand handler. */
  exitCode: number;
  /** Deprecation message for the binary to print to stderr, if any. */
  deprecation?: string;
}

/**
 * Inspect argv for a global short-circuit (`--help`, `-h`,
 * `--version`, `-v`) without consuming positional args.
 */
function checkGlobalFlags(argv: readonly string[]): 'help' | 'version' | null {
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return 'help';
    if (arg === '--version' || arg === '-v') return 'version';
  }
  return null;
}

/**
 * Detect whether legacy bare-command sim invocations were used.
 * Heuristic: argv has no recognized subcommand at index 0, and at
 * least one entry is a known sim flag OR a positional integer.
 */
function looksLikeLegacyRun(argv: readonly string[]): boolean {
  for (const arg of argv) {
    if (LEGACY_RUN_FLAGS.has(arg)) return true;
    if (/^\d+$/.test(arg)) return true;
  }
  return false;
}

/**
 * Dispatch argv to the appropriate subcommand handler. Pure: no
 * process.exit, no top-level await side effects.
 */
export async function dispatch(argv: readonly string[]): Promise<DispatchResult> {
  // Global short-circuits first; they win at any position.
  const global = checkGlobalFlags(argv);
  if (global === 'version') {
    process.stdout.write(`paracosm ${readPackageVersion()}\n`);
    return { exitCode: 0 };
  }
  if (global === 'help' && (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h')) {
    printTopLevelHelp();
    return { exitCode: 0 };
  }

  const [command, ...rest] = argv;

  // No args: print help.
  if (!command) {
    printTopLevelHelp();
    return { exitCode: 0 };
  }

  // `--help` / `-h` after a known subcommand: print that command's help.
  const commandHelpFlagPresent = rest.includes('--help') || rest.includes('-h');
  if (KNOWN_COMMANDS.has(command) && commandHelpFlagPresent) {
    printCommandHelp(command);
    return { exitCode: 0 };
  }

  switch (command) {
    case 'help': {
      const target = rest[0];
      if (target) {
        printCommandHelp(target);
      } else {
        printTopLevelHelp();
      }
      return { exitCode: 0 };
    }

    case 'version': {
      process.stdout.write(`paracosm ${readPackageVersion()}\n`);
      return { exitCode: 0 };
    }

    case 'run': {
      const { runSim } = await import('../cli/run-sim.js');
      const exitCode = await runSim(rest);
      return { exitCode };
    }

    case 'dashboard': {
      const { runDashboard } = await import('../cli/run-dashboard.js');
      const exitCode = await runDashboard(rest);
      return { exitCode };
    }

    case 'compile': {
      const { runCompile } = await import('../cli/run-compile.js');
      const exitCode = await runCompile(rest);
      return { exitCode };
    }

    case 'init': {
      const { runInit } = await import('../cli/init.js');
      const exitCode = await runInit(rest);
      return { exitCode };
    }

    default:
      // Legacy fallthrough: bare `paracosm --leader 0 6` etc. dispatched
      // to `run` with a deprecation hint. Removal scheduled for 0.8.0.
      if (looksLikeLegacyRun(argv)) {
        const { runSim } = await import('../cli/run-sim.js');
        const exitCode = await runSim(argv);
        return {
          exitCode,
          deprecation: 'bare `paracosm <flags>` is deprecated; use `paracosm run <flags>` instead. Removal in 0.8.0.',
        };
      }
      process.stderr.write(`Unknown command: ${command}\n\n`);
      printTopLevelHelp();
      return { exitCode: 1 };
  }
}
