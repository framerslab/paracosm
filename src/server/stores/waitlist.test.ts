import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaitlistStore } from './waitlist.js';

function freshStore() {
  return createWaitlistStore({ databaseOptions: { file: ':memory:' } });
}

test('insert + count', async () => {
  const store = freshStore();
  const result = await store.insertOrGetExisting({
    email: 'a@b.co',
    name: 'A',
    useCase: 'testing',
    source: 'organic',
    ip: '1.2.3.4',
  });
  assert.equal(result.alreadyExisted, false);
  assert.equal(result.position, 1);
  assert.ok(result.id > 0);
  assert.equal(await store.count(), 1);
});

test('insert is idempotent on email (case-insensitive)', async () => {
  const store = freshStore();
  const first = await store.insertOrGetExisting({ email: 'foo@bar.co' });
  const second = await store.insertOrGetExisting({ email: 'FOO@bar.co' });
  assert.equal(second.alreadyExisted, true);
  assert.equal(second.id, first.id);
  assert.equal(second.position, first.position);
  assert.equal(await store.count(), 1);
});

test('position is the row number among existing rows', async () => {
  const store = freshStore();
  const r1 = await store.insertOrGetExisting({ email: 'a@x.co' });
  const r2 = await store.insertOrGetExisting({ email: 'b@x.co' });
  const r3 = await store.insertOrGetExisting({ email: 'c@x.co' });
  assert.equal(r1.position, 1);
  assert.equal(r2.position, 2);
  assert.equal(r3.position, 3);
});

test('findByEmail is case-insensitive', async () => {
  const store = freshStore();
  await store.insertOrGetExisting({ email: 'mixed@CASE.co', name: 'Mx' });
  const found = await store.findByEmail('MIXED@case.co');
  assert.ok(found);
  assert.equal(found?.name, 'Mx');
});

test('insert handles all-null optional fields', async () => {
  const store = freshStore();
  const r = await store.insertOrGetExisting({ email: 'min@x.co' });
  assert.equal(r.alreadyExisted, false);
  const found = await store.findByEmail('min@x.co');
  assert.equal(found?.name, null);
  assert.equal(found?.useCase, null);
  assert.equal(found?.source, null);
  assert.equal(found?.ip, null);
  // userType defaults to 'hobbyist' when not supplied.
  assert.equal(found?.userType, 'hobbyist');
});

test('userType is persisted when supplied', async () => {
  const store = freshStore();
  await store.insertOrGetExisting({ email: 'vc@x.co', userType: 'vc' });
  await store.insertOrGetExisting({ email: 'dev@x.co', userType: 'developer' });
  const vc = await store.findByEmail('vc@x.co');
  const dev = await store.findByEmail('dev@x.co');
  assert.equal(vc?.userType, 'vc');
  assert.equal(dev?.userType, 'developer');
});

test('listAll returns rows in insertion order', async () => {
  const store = freshStore();
  await store.insertOrGetExisting({ email: 'a@x.co', userType: 'investor' });
  await store.insertOrGetExisting({ email: 'b@x.co', userType: 'developer' });
  await store.insertOrGetExisting({ email: 'c@x.co' });
  const all = await store.listAll();
  assert.equal(all.length, 3);
  assert.deepEqual(
    all.map((e) => e.email),
    ['a@x.co', 'b@x.co', 'c@x.co'],
  );
  assert.equal(all[2].userType, 'hobbyist');
});
