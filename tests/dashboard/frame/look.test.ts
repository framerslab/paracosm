import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { initialLook } from '../../../src/dashboard/src/theme/look.js';

test('initialLook uses a stored choice only when it names a look', () => {
  for (const prefersLight of [true, false]) {
    assert.equal(initialLook('light', prefersLight), 'light');
    assert.equal(initialLook('dark', prefersLight), 'dark');
    for (const stored of [null, 'system', '"light"', '']) {
      assert.equal(initialLook(stored, prefersLight), prefersLight ? 'light' : 'dark', JSON.stringify(stored));
    }
  }
});
