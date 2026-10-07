#!/usr/bin/env npx tsx
/**
 * Extract every TypeScript code-block from `landing.html` and
 * type-check each against the local paracosm package.
 *
 * Catches doc/code drift before publish: if a public-facing example
 * imports from a removed subpath, calls a renamed method, or uses an
 * outdated option name, the script exits non-zero so CI blocks the push.
 *
 * @module paracosm/scripts/check-doc-examples
 */
import { readFileSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const SANDBOX = resolve('/tmp/paracosm-doc-check');

// Clear the sandbox between runs so removed examples don't linger.
if (existsSync(`${SANDBOX}/wrapped`)) rmSync(`${SANDBOX}/wrapped`, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });
mkdirSync(`${SANDBOX}/wrapped`, { recursive: true });

// ── Step 1: pull every code-body from landing.html ────────────────────
const landingHtml = readFileSync(`${REPO_ROOT}/src/dashboard/landing.html`, 'utf8');
const landingRe = /<div[^>]*class="code-body"[^>]*id="([a-z0-9-]+-code)"[^>]*>([\s\S]*?)<\/div>/g;
const blocks: { id: string; text: string }[] = [];
let m: RegExpExecArray | null;
while ((m = landingRe.exec(landingHtml)) !== null) {
  const id = m[1];
  const text = m[2]
    .replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '')
    .replace(/<button[\s\S]*?<\/button>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  blocks.push({ id, text: text.trim() });
}

// ── Step 2: filter to TypeScript blocks (skip shell, JSON, etc.) ───────
// A block is TS only when it has a real `import ... from '...'` line OR
// uses an obvious TS-method call pattern. Pure shell snippets that
// happen to mention "import-attributes" in a comment are excluded.
const tsBlocks = blocks.filter((b) => {
  const hasImportFrom = /^\s*import\b[\s\S]*?from\s+['"]/m.test(b.text);
  const hasMethodCall = /\bWorldModel\.|\.simulate\(|\.intervene\(|\brunMany\(|\brun\(/.test(b.text);
  return hasImportFrom || hasMethodCall;
});

// Step 3: stubs for placeholder identifiers used in docs
const STUBS = `
declare const worldJson: any;
declare const leader: any;
declare const actor: any;
declare const altActor: any;
declare const altLeader: any;
declare const reyes: any;
declare const okafor: any;
declare const scenario: any;
declare const baseline: any;
declare const wm: any;
declare const myLeader: any;
declare const seedText: string;
declare const subject: any;
declare const intervention: any;
`;

for (const b of tsBlocks) {
  const lines = b.text.split('\n');
  const imports = lines
    .filter((l) => l.trim().startsWith('import '))
    .filter((l) => !l.includes(`with { type: 'json' }`));
  const body = lines.filter((l) => !l.trim().startsWith('import ')).join('\n');
  const wrapped = [
    `// Auto-wrapped from landing.html#${b.id}`,
    ...imports,
    STUBS,
    '',
    '(async () => {',
    body,
    '})();',
  ].join('\n');
  writeFileSync(`${SANDBOX}/wrapped/${b.id}.ts`, wrapped);
}

// ── Step 4: write a tsconfig with `paths` mapping for `paracosm` ──────
// The wrapped examples import from `paracosm` and `paracosm/<sub>`. In the
// sandbox we don't have node_modules — point those imports at the local
// repo's source via tsconfig paths so they type-check against THIS code.
// Standalone tsconfig with `paths` mapping. We don't extend the build
// tsconfig because its `rootDir: src` collides with our sandbox layout.
// `skipLibCheck: true` + `strict: false` keeps us focused on doc-shape
// drift, not pre-existing type imperfections in the program graph.
const sandboxTsconfig = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    strict: true,
    noEmit: true,
    declaration: false,
    // Examples are illustrative and use placeholder vars — relax just
    // enough so they compile without forcing every example to declare
    // every helper variable's full type.
    noImplicitAny: false,
    typeRoots: [`${REPO_ROOT}/node_modules/@types`],
    types: ['node'],
    paths: {
      'paracosm': [`${REPO_ROOT}/src/index.ts`],
      'paracosm/core': [`${REPO_ROOT}/src/engine/core/state.ts`],
      'paracosm/compiler': [`${REPO_ROOT}/src/engine/compiler/index.ts`],
      'paracosm/schema': [`${REPO_ROOT}/src/engine/schema/index.ts`],
      'paracosm/swarm': [`${REPO_ROOT}/src/runtime/swarm/index.ts`],
      'paracosm/digital-twin': [`${REPO_ROOT}/src/engine/digital-twin/index.ts`],
    },
  },
  include: [`wrapped/*.ts`],
};
writeFileSync(`${SANDBOX}/tsconfig.json`, JSON.stringify(sandboxTsconfig, null, 2));

// ── Step 5: typecheck each (against the sandbox tsconfig with paths) ──
let failed = 0;
const summary: { id: string; ok: boolean; err?: string }[] = [];
for (const f of readdirSync(`${SANDBOX}/wrapped`)) {
  if (!f.endsWith('.ts')) continue;
  process.stdout.write(`  ${f.padEnd(36)} ... `);
  try {
    execSync(
      `cd "${REPO_ROOT}" && npx tsc --noEmit -p "${SANDBOX}/tsconfig.json"`,
      { stdio: 'pipe' },
    );
    // tsc with -p compiles the whole include in one shot. We loop only for
    // reporting symmetry. Break after first pass.
    process.stdout.write('OK (batch)\n');
    summary.push({ id: f, ok: true });
    break;
  } catch (err) {
    failed += 1;
    process.stdout.write('FAIL\n');
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? '';
    const stdout = (err as { stdout?: Buffer }).stdout?.toString() ?? '';
    const out = (stderr + stdout).split('\n').slice(0, 30).map((l) => `    ${l}`).join('\n');
    process.stdout.write(out);
    process.stdout.write('\n');
    summary.push({ id: f, ok: false, err: stderr });
    break;
  }
}

if (failed > 0) {
  process.stderr.write(`\n${failed} doc example(s) failed to type-check\n`);
  process.exit(1);
}
process.stdout.write(`\nAll ${tsBlocks.length} doc examples type-check\n`);
