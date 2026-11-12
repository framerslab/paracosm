/**
 * The compiler's hook cache stays in one folder directly inside its cache
 * folder, whatever id and version the scenario JSON carries.
 *
 * POST /compile, the quickstart compile and the boot re-compile all hand a
 * scenario JSON to compileScenario with the cache on, and the cache folder
 * of a scenario is named from that JSON's id and version. A plain id and
 * version keep the folder name `<id>-v<version>`, so a warm cache stays
 * warm; an id or version with a path separator or a `..` segment must not
 * choose a folder anywhere else.
 *
 * Every test compiles the deep-ocean station (scenarios/submarine.json)
 * with a stub model, so no model is called, and a cache folder two levels
 * inside a temporary folder of its own, so a file written anywhere in that
 * temporary folder, inside the cache folder or beside it, shows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileScenario } from '../../../src/engine/compiler/index.js';
import type { GenerateTextFn } from '../../../src/engine/compiler/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const submarine = JSON.parse(
  readFileSync(resolve(here, '../../../scenarios/submarine.json'), 'utf-8'),
) as Record<string, unknown>;

/**
 * A stub model with valid sources for three hooks of the deep-ocean
 * station (the ones tests/engine/compiler/integration.test.ts uses); the
 * other hooks fall back and are not cached. Counts the progression calls.
 */
function stubModel() {
  const calls = { progression: 0 };
  const generateText = async (
    args: string | { system?: Array<{ text: string }>; prompt: string },
  ): Promise<string> => {
    const text = typeof args === 'string'
      ? args
      : [...(args.system ?? []).map(block => block.text), args.prompt].join('\n');
    if (text.includes('progression hook')) {
      calls.progression += 1;
      return `(ctx) => {
        for (const c of ctx.agents) {
          if (!c.health.alive) continue;
          c.health.psychScore = Math.max(0.1, c.health.psychScore - 0.02 * ctx.timeDelta);
          c.health.boneDensityPct = Math.max(60, c.health.boneDensityPct - 0.2 * ctx.timeDelta);
        }
      }`;
    }
    if (text.includes('politics hook')) {
      return `(category, outcome) => {
        if (category !== 'communications' && category !== 'scientific') return null;
        return outcome.includes('success') ? { fundingConfidence: 5, autonomyLevel: 3 } : { fundingConfidence: -3, autonomyLevel: -2 };
      }`;
    }
    if (text.includes('reaction context hook')) {
      return `(colonist, ctx) => {
        const lines = [];
        if (colonist.core?.marsborn) lines.push('Born aboard the station, has never seen the surface.');
        else lines.push('Surface-born, ' + (ctx.time - 2038) + ' years underwater.');
        return lines.join(' ');
      }`;
    }
    return '() => null';
  };
  return { calls, generateText: generateText as unknown as GenerateTextFn };
}

/** Every file under `root`, as paths relative to it, sorted. */
function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(root, path));
    }
  };
  walk(root);
  return out.sort();
}

interface Sandbox {
  root: string;
  /** `<root>/app/cache`, the compiler's cache folder. */
  cacheDir: string;
}

async function withSandbox(body: (box: Sandbox) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'paracosm-cache-folder-'));
  const cacheDir = join(root, 'app', 'cache');
  mkdirSync(cacheDir, { recursive: true });
  try {
    await body({ root, cacheDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Compile the station with this id and version and the cache on. */
async function compileWith(cacheDir: string, generateText: GenerateTextFn, id: unknown, version: unknown): Promise<void> {
  await compileScenario({ ...submarine, id, version }, { cache: true, cacheDir, generateText });
}

/** The files under the cache folder, each as `[folder, file]` when it sits one folder deep. */
function cacheEntries(root: string, cacheDir: string): string[][] {
  const cacheRel = relative(root, cacheDir);
  return filesUnder(root)
    .filter(path => path.startsWith(`${cacheRel}${sep}`))
    .map(path => relative(cacheRel, path).split(sep));
}

test('a plain id and version cache in <id>-v<version>, one folder directly inside the cache folder', async () => {
  await withSandbox(async ({ root, cacheDir }) => {
    const { generateText } = stubModel();
    await compileWith(cacheDir, generateText, 'deep-ocean-station', '1.0.0');
    const cacheRel = relative(root, cacheDir);
    const files = filesUnder(root);
    assert.ok(files.length > 0, 'the compile cached something');
    assert.deepEqual(files.filter(path => !path.startsWith(`${cacheRel}${sep}`)), [], 'no file outside the cache folder');
    assert.ok(
      files.includes(join(cacheRel, 'deep-ocean-station-v1.0.0', 'manifest.json')),
      `the manifest sits in deep-ocean-station-v1.0.0: ${JSON.stringify(files)}`,
    );
  });
});

test('an id or version with a path separator or a dot segment never writes outside one folder of the cache folder', async (t) => {
  const cases: Array<{ name: string; id: unknown; version: unknown }> = [
    { name: 'an id that climbs one level', id: '../escape', version: '1.0.0' },
    { name: 'an id that climbs two levels', id: '../../escape', version: '1.0.0' },
    { name: 'a version that climbs out', id: 'deep-ocean-station', version: '1/../../escape' },
    { name: 'an id with a path separator', id: 'nested/child', version: '1.0.0' },
    { name: 'an absolute path as the id', id: '/absolute/escape', version: '1.0.0' },
    { name: 'a backslash in the id', id: '..\\escape', version: '1.0.0' },
  ];
  for (const c of cases) {
    await t.test(c.name, async () => {
      await withSandbox(async ({ root, cacheDir }) => {
        const { generateText } = stubModel();
        await compileWith(cacheDir, generateText, c.id, c.version);
        const cacheRel = relative(root, cacheDir);
        const files = filesUnder(root);
        assert.deepEqual(
          files.filter(path => !path.startsWith(`${cacheRel}${sep}`)),
          [],
          `files written outside the cache folder for id ${JSON.stringify(c.id)}, version ${JSON.stringify(c.version)}`,
        );
        const entries = cacheEntries(root, cacheDir);
        assert.ok(entries.length > 0, 'the compile cached something');
        assert.deepEqual(
          entries.filter(parts => parts.length !== 2),
          [],
          'every cached file sits in one folder directly inside the cache folder',
        );
        assert.equal(new Set(entries.map(parts => parts[0])).size, 1, 'one folder for the scenario');
      });
    });
  }
});

test('a second compile of an id with a dot segment reads the cache the first one wrote', async () => {
  await withSandbox(async ({ cacheDir }) => {
    const first = stubModel();
    await compileWith(cacheDir, first.generateText, '../escape', '1.0.0');
    assert.ok(first.calls.progression > 0, 'the first compile asked the model');
    const second = stubModel();
    await compileWith(cacheDir, second.generateText, '../escape', '1.0.0');
    assert.equal(second.calls.progression, 0, 'the second compile read the progression hook from the cache');
  });
});
