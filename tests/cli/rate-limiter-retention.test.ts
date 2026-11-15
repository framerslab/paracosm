import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IpRateLimiter } from '../../src/server/rate-limiter.js';

for (const bucket of ['sim', 'compile', 'chat', 'quickstart']) {
  test(`loading an ended ${bucket} count removes its address from the saved copy`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'paracosm-limit-retention-'));
    const path = join(dir, 'limits.json');
    const address = '198.51.100.7';
    const active = '198.51.100.8';
    writeFileSync(path, JSON.stringify({ [bucket]: {
      [address]: { count: 1, resetAt: Date.now() - 1 },
      [active]: { count: 2, resetAt: Date.now() + 60_000 },
    } }));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const limiter = new IpRateLimiter(3, 5, 30, path);
    try {
      t.mock.timers.tick(500);
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      assert.equal(saved[bucket][address], undefined);
      assert.equal(saved[bucket][active].count, 2);
    } finally {
      limiter.destroy();
      t.mock.timers.reset();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
