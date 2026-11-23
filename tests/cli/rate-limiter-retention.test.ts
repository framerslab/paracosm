import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync, lstatSync } from 'node:fs';
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

test('rate limits keep their state in the linked writable directory', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-limit-directory-'));
  const state = join(dir, '.paracosm');
  mkdirSync(state);
  const target = join(state, 'rate-limit.json');
  const path = join(dir, '.rate-limit.json');
  const address = '198.51.100.9';
  writeFileSync(target, JSON.stringify({ sim: {
    [address]: { count: 1, resetAt: Date.now() + 60_000 },
  } }));
  symlinkSync(target, path);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const limiter = new IpRateLimiter(3, 5, 30, path);
  try {
    limiter.record(address);
    t.mock.timers.tick(500);
    assert.equal(lstatSync(path).isSymbolicLink(), true, 'the link in the application directory stays in place');
    assert.equal(JSON.parse(readFileSync(target, 'utf8')).sim[address].count, 2);
    limiter.record(address);
    t.mock.timers.tick(500);
    assert.equal(JSON.parse(readFileSync(target, 'utf8')).sim[address].count, 3);
  } finally {
    limiter.destroy();
    t.mock.timers.reset();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rate limits warn once per sequence of failed saves', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-limit-save-'));
  const state = join(dir, 'state');
  const path = join(state, 'limits.json');
  const warn = t.mock.method(console, 'warn', () => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const limiter = new IpRateLimiter(10, 5, 30, path);
  const save = () => {
    limiter.record('198.51.100.7');
    t.mock.timers.tick(500);
  };
  try {
    save();
    save();
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0].arguments[0]), /rate-limit.*save/i);
    mkdirSync(state);
    save();
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).sim['198.51.100.7'].count, 3);
    rmSync(state, { recursive: true });
    save();
    assert.equal(warn.mock.callCount(), 2);
  } finally {
    limiter.destroy();
    rmSync(dir, { recursive: true, force: true });
  }
});
