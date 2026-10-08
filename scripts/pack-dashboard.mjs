#!/usr/bin/env node
/**
 * Copies the built dashboard into `dist/` before npm packs the package (the
 * `prepack` script). The server resolves the dashboard relative to its own
 * file (src/server/server-app.ts): run from `dist/server/`, it serves the Vite
 * build from `dist/dashboard/dist/` and the landing page from
 * `dist/dashboard/landing.html`, so the `paracosm-dashboard` command an npm
 * user installs needs both there.
 *
 * Build first: `npm run build` (the server) and `npm run dashboard:build`.
 * The script stops when either is missing, or when a file the dashboard page
 * loads from /assets/ is not in the build, so a package whose dashboard
 * command has nothing to serve is never packed. It writes to stderr, which
 * keeps the standard output of `npm pack --json` clean.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dashboardBuild = resolve(root, 'src/dashboard/dist');
const landingPage = resolve(root, 'src/dashboard/landing.html');
const target = resolve(root, 'dist/dashboard');

function stop(message) {
  console.error(`pack-dashboard: ${message}`);
  process.exit(1);
}

if (!existsSync(resolve(root, 'dist/server/server-app.js'))) {
  stop('dist/server/server-app.js is missing. Run `npm run build` before packing.');
}
if (!existsSync(resolve(dashboardBuild, 'index.html'))) {
  stop('src/dashboard/dist/index.html is missing. Run `npm run dashboard:build` before packing.');
}
// The page must find its bundle beside it: an index.html left from another build
// would pack a dashboard that loads nothing.
const bundle = [...readFileSync(resolve(dashboardBuild, 'index.html'), 'utf8').matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(
  (match) => match[1],
);
if (!bundle.some((asset) => asset.endsWith('.js'))) {
  stop('src/dashboard/dist/index.html loads no /assets/*.js bundle. Run `npm run dashboard:build` before packing.');
}
const absent = bundle.filter((asset) => !existsSync(resolve(dashboardBuild, asset.slice(1))));
if (absent.length > 0) {
  stop(`src/dashboard/dist/index.html loads ${absent.join(', ')}, which the build lacks. Run \`npm run dashboard:build\` before packing.`);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dashboardBuild, resolve(target, 'dist'), { recursive: true });
cpSync(landingPage, resolve(target, 'landing.html'));
console.error('pack-dashboard: copied src/dashboard/dist and src/dashboard/landing.html into dist/dashboard');
