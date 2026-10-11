#!/usr/bin/env node
/**
 * Sitemap check: every /docs URL in src/dashboard/public/sitemap.xml names a
 * file the TypeDoc build wrote to docs/api, and the sitemap lists every module
 * page that build wrote to docs/api/modules. Run after `npm run docs`.
 *
 * Why this check exists: TypeDoc names a module page after the entry point's
 * `@module` tag (`paracosm/compiler` becomes modules/paracosm_compiler.html),
 * so renaming a tag or adding an entry point in typedoc.json changes the page
 * names. The sitemap is written by hand and once listed ten module pages that
 * no longer existed. The server answers /docs and /docs/ with a redirect to
 * /docs/modules.html, so neither belongs in a sitemap.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SITEMAP = join(ROOT, 'src', 'dashboard', 'public', 'sitemap.xml');
const DOCS_DIR = join(ROOT, 'docs', 'api');
const ORIGIN = 'https://paracosm.agentos.sh';

if (!existsSync(DOCS_DIR)) {
  console.error('docs/api does not exist. Run `npm run docs` before this check.');
  process.exit(1);
}

const locs = [...readFileSync(SITEMAP, 'utf8').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
const problems = [];
const listedModulePages = new Set();

for (const loc of locs) {
  if (!loc.startsWith(`${ORIGIN}/`)) {
    problems.push(`${loc}: not a URL on ${ORIGIN}`);
    continue;
  }
  const urlPath = loc.slice(ORIGIN.length);
  if (urlPath !== '/docs' && !urlPath.startsWith('/docs/')) continue;
  if (urlPath === '/docs' || urlPath === '/docs/') {
    problems.push(`${loc}: the server redirects this to /docs/modules.html; list that page instead`);
    continue;
  }
  const rel = urlPath.slice('/docs/'.length);
  const file = join(DOCS_DIR, rel);
  if (!existsSync(file) || !statSync(file).isFile()) {
    problems.push(`${loc}: docs/api/${rel} was not built`);
  }
  if (/^modules\/[^/]+\.html$/.test(rel)) listedModulePages.add(rel);
}

const modulesDir = join(DOCS_DIR, 'modules');
const builtModulePages = existsSync(modulesDir)
  ? readdirSync(modulesDir).filter((name) => name.endsWith('.html')).map((name) => `modules/${name}`)
  : [];
for (const page of builtModulePages) {
  if (!listedModulePages.has(page)) {
    problems.push(`docs/api/${page} was built but ${ORIGIN}/docs/${page} is not in the sitemap`);
  }
}

if (problems.length > 0) {
  console.error('Sitemap check failed:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`Sitemap check passed (${locs.length} URLs, ${builtModulePages.length} module pages).`);
