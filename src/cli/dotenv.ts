/**
 * Reads `.env` from the working directory into process.env. A variable
 * that already has a value wins; one that is unset or empty takes the
 * file's value, as the dashboard has always read it. A value in matching
 * single or double quotes is taken without them. `paracosm dashboard`, `paracosm run` and
 * the mail scripts all read `.env` through this one function, so they
 * agree on APP_DIR, and with it on the data/ folder the stores live in.
 *
 * @module paracosm/cli/dotenv
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** What {@link loadDotEnvFromCwd} read: the file's path and how many variables it set. */
export interface LoadedDotEnv {
  path: string;
  loaded: number;
}

/** Loads `./.env` into process.env as the module header describes, and says what it set. */
export function loadDotEnvFromCwd(): LoadedDotEnv {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return { path, loaded: 0 };
  let loaded = 0;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const quoted = /^(["'])(.*)\1$/.exec(match[2]);
    process.env[match[1]] = quoted ? quoted[2] : match[2];
    loaded += 1;
  }
  return { path, loaded };
}
