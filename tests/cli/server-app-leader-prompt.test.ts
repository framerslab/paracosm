import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { captureMarsOpenings } from './helpers/leader-prompt-wire.js';

test('both Mars commanders receive the original system prompt and opening message byte for byte', async () => {
  const fixture = process.env.PARACOSM_TEST_ORIGINAL_PROMPTS
    ?? new URL('../fixtures/leader-prompt/mars-opening.json', import.meta.url);
  const original = JSON.parse(await readFile(fixture, 'utf8')) as Awaited<ReturnType<typeof captureMarsOpenings>>;
  const actual = await captureMarsOpenings();
  for (const leader of ['aria', 'dietrich'] as const) {
    for (const part of ['system', 'opening'] as const) {
      assert.ok(
        Buffer.from(actual[leader][part], 'utf8').equals(Buffer.from(original[leader][part], 'utf8')),
        `${leader}'s ${part} changed from the original wire capture`,
      );
    }
  }
});
