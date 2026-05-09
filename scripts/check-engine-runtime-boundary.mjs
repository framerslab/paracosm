#!/usr/bin/env node
/**
 * Boundary check: src/engine/ files do not import from src/runtime/
 * except in the public-API alias barrel file
 * src/engine/digital-twin/index.ts. Run as part of `npm test`.
 *
 * Why this rule exists: engine/ is the scenario kernel + compile-time;
 * runtime/ is the per-turn simulation execution. The arrow goes
 * runtime -> engine and llm -> engine, never the reverse. Public-API
 * alias barrels are exempt because they exist precisely to surface a
 * runtime symbol under an engine-themed name (e.g.,
 * `paracosm/digital-twin` aliases `runtime/world-model.WorldModel`
 * as `DigitalTwin`).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ENGINE_DIR = join(HERE, '..', 'src', 'engine');
const ROOT = join(HERE, '..');

const EXEMPT = new Set([
  'src/engine/digital-twin/index.ts',
]);

const RUNTIME_IMPORT_RE = /from\s+['"](?:\.\.\/)+runtime\//;
const RUNTIME_DYNAMIC_IMPORT_RE = /import\(\s*['"](?:\.\.\/)+runtime\//;
const RUNTIME_SIDE_EFFECT_IMPORT_RE = /^\s*import\s+['"](?:\.\.\/)+runtime\//m;
const RUNTIME_REEXPORT_RE = /export\s+(?:\*|{[^}]*})\s+from\s+['"](?:\.\.\/)+runtime\//;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      yield full;
    }
  }
}

const violations = [];
for await (const file of walk(ENGINE_DIR)) {
  const rel = file.slice(ROOT.length + 1);
  if (EXEMPT.has(rel)) continue;
  const text = await readFile(file, 'utf8');
  if (
    RUNTIME_IMPORT_RE.test(text) ||
    RUNTIME_DYNAMIC_IMPORT_RE.test(text) ||
    RUNTIME_SIDE_EFFECT_IMPORT_RE.test(text) ||
    RUNTIME_REEXPORT_RE.test(text)
  ) {
    violations.push(rel);
  }
}

if (violations.length > 0) {
  console.error('Engine -> runtime boundary violation:');
  for (const v of violations) {
    console.error(`  ${v}`);
  }
  console.error('\nIf the import is genuinely needed, move shared helpers to src/llm/ or refactor.');
  console.error('Public-API alias barrel files (currently src/engine/digital-twin/index.ts) are exempt.');
  process.exit(1);
}

console.log(`Boundary check passed (${EXEMPT.size} exempt files).`);
