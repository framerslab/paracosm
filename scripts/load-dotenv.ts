/**
 * Loads `.env` from the working directory into process.env, the way the
 * dashboard server is configured on the host, without replacing a
 * variable that is already set. A value in matching quotes is taken
 * without them. The mail scripts call it first, so they
 * find the same APP_DIR, and with it the same data/ folder, as the server.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.+?)\s*$/);
    if (!m || process.env[m[1]]) continue;
    // A value in matching single or double quotes is taken without them.
    const quoted = /^(["'])(.*)\1$/.exec(m[2]);
    process.env[m[1]] = quoted ? quoted[2] : m[2];
  }
}
