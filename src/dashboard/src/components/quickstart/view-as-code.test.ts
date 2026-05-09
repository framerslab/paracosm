import test from 'node:test';
import assert from 'node:assert/strict';

import { renderTsRecipe, renderCurlRecipe, type RecipeInput } from './view-as-code.js';

// baseInput uses the dashboard's default actor count (2). Tests that
// need to assert the "non-default" branch in renderCurlRecipe pass an
// explicit override (5).
const baseInput: RecipeInput = {
  seedText: 'A coastal mayor must evacuate.',
  actorCount: 2,
};

test('renderTsRecipe: base case — emits v0.9 runMany with brief + count', () => {
  const out = renderTsRecipe(baseInput);
  assert.match(out, /^import \{ runMany \} from 'paracosm';/m);
  assert.match(out, /const \{ runs \} = await runMany\(/);
  assert.match(out, /`A coastal mayor must evacuate\.`/);
  assert.match(out, /\{ count: 2 \}/);
  assert.match(out, /runs\.forEach\(\(\{ actor, artifact \}\)/);
  // Old v0.8 shape is gone:
  assert.ok(!out.includes('paracosm/world-model'), 'no v0.8 subpath');
  assert.ok(!out.includes('WorldModel.fromPrompt'), 'no v0.8 factory');
  assert.ok(!out.includes('wm.quickstart'), 'no v0.8 quickstart');
});

test('renderTsRecipe: escapes literal backticks in brief', () => {
  const out = renderTsRecipe({ seedText: 'price is `$14`/mo', actorCount: 3 });
  assert.ok(out.includes('`price is \\`$14\\`/mo`'), out);
});

test('renderTsRecipe: escapes ${ template-literal interpolation in brief', () => {
  const out = renderTsRecipe({ seedText: 'cost ${burn}', actorCount: 3 });
  assert.ok(out.includes('`cost \\${burn}`'), out);
});

test('renderTsRecipe: escapes literal backslash in brief, preserves newlines', () => {
  const out = renderTsRecipe({ seedText: 'path C:\\users\nbreak', actorCount: 3 });
  assert.ok(out.includes('`path C:\\\\users\nbreak`'), out);
});

// v0.9 runMany doesn't surface domainHint at the top level — visitors
// fold domain context directly into the brief. Tests for the v0.8
// `domainHint:` emission were removed alongside the refactor.

test('renderTsRecipe: emits sourceUrl branch using new URL(...)', () => {
  const out = renderTsRecipe({ ...baseInput, sourceUrl: 'https://example.com/article' });
  assert.match(out, /new URL\('https:\/\/example\.com\/article'\)/);
});

test('renderTsRecipe: omits sourceUrl from brief branch', () => {
  const out = renderTsRecipe(baseInput);
  assert.ok(!out.includes('sourceUrl'));
  assert.ok(!out.includes('new URL'));
});

test('renderTsRecipe: emits count for any value (always shown in v0.9)', () => {
  const out5 = renderTsRecipe({ ...baseInput, actorCount: 5 });
  const out1 = renderTsRecipe({ ...baseInput, actorCount: 1 });
  assert.match(out5, /\{ count: 5 \}/);
  assert.match(out1, /\{ count: 1 \}/);
});

test('renderTsRecipe: empty seedText falls back to placeholder, recipe still copies as a recipe', () => {
  const out = renderTsRecipe({ seedText: '', actorCount: 3 });
  assert.match(out, /`<paste your scenario above>`/);
});

test('renderCurlRecipe: base case — POSTs to compile-from-seed with seedText only', () => {
  const out = renderCurlRecipe(baseInput);
  assert.match(out, /^# This compiles a typed ScenarioPackage from your prompt\./m);
  assert.match(out, /^curl -X POST https:\/\/paracosm\.agentos\.sh\/api\/quickstart\/compile-from-seed/m);
  assert.match(out, /-H 'Content-Type: application\/json'/);
  assert.match(out, /-d '\{"seedText":"A coastal mayor must evacuate\."\}'/);
});

test("renderCurlRecipe: escapes literal single quote in seedText via the sh-quote idiom", () => {
  // Pass actorCount=2 (the dashboard default) so the curl body stays
  // minimal — the test is asserting the sh-quote escape, not the
  // actorCount branch.
  const out = renderCurlRecipe({ seedText: "it's fine", actorCount: 2 });
  // JSON is `{"seedText":"it's fine"}`; shell wrap with `'...'` and the
  // single quote inside becomes `'\''`. Final emitted -d argument:
  // '{"seedText":"it'\''s fine"}'
  assert.ok(out.includes(`-d '{"seedText":"it'\\''s fine"}'`), out);
});

test('renderCurlRecipe: emits domainHint when present, actorCount when not default', () => {
  const out = renderCurlRecipe({ ...baseInput, domainHint: 'urban planning', actorCount: 5 });
  assert.match(out, /"domainHint":"urban planning"/);
  assert.match(out, /"actorCount":5/);
});

test('renderCurlRecipe: omits domainHint when blank, actorCount when default', () => {
  const out = renderCurlRecipe({ ...baseInput, domainHint: '   ' });
  assert.ok(!out.includes('domainHint'));
  assert.ok(!out.includes('actorCount'));
});

test('renderCurlRecipe: empty seedText falls back to placeholder', () => {
  const out = renderCurlRecipe({ seedText: '', actorCount: 3 });
  assert.match(out, /"seedText":"<paste your scenario above>"/);
});
