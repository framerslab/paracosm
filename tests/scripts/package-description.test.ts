import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * npm keeps at most 255 characters of a package's description and drops the rest mid-word:
 * 0.9.1190's description was 312 characters, and npm served it ending "Deterministic kernel, runti".
 */
const NPM_DESCRIPTION_LIMIT = 255;

test("the package description fits npm's 255-character limit whole", () => {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { description?: string };
  const description = pkg.description ?? '';
  assert.ok(description.length > 0, 'package.json has a description');
  assert.ok(description.length <= NPM_DESCRIPTION_LIMIT, `the description is ${description.length} characters; npm keeps ${NPM_DESCRIPTION_LIMIT}`);
  assert.match(description, /[.!?]$/, 'the description ends on a whole sentence');
});
