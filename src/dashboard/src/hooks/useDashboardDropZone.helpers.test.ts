/**
 * Pure-logic tests for useDashboardDropZone's helpers. Helpers file
 * pattern matches useLoadPreview.helpers + LoadMenu.helpers so they
 * run under node:test without a browser shim.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateDropFiles,
  hasFilesDragPayload,
} from './useDashboardDropZone.helpers.js';

function fakeFile(name: string, size = 128): File {
  // node:test runs in a Node env that doesn't have File; the helpers
  // only read `.name` and `.size`, so a structural duck works.
  return { name, size, type: 'application/json' } as unknown as File;
}

test('validateDropFiles: empty list -> kind=empty, no file', () => {
  const r = validateDropFiles([]);
  assert.equal(r.kind, 'empty');
});

test('validateDropFiles: single .json -> kind=ok, file present', () => {
  const f = fakeFile('save.json');
  const r = validateDropFiles([f]);
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') assert.equal(r.file, f);
});

test('validateDropFiles: single .JSON (uppercase) -> kind=ok', () => {
  const r = validateDropFiles([fakeFile('SAVE.JSON')]);
  assert.equal(r.kind, 'ok');
});

test('validateDropFiles: single non-JSON -> kind=unsupported', () => {
  const r = validateDropFiles([fakeFile('notes.pdf')]);
  assert.equal(r.kind, 'unsupported');
});

test('validateDropFiles: no-extension file -> kind=unsupported', () => {
  const r = validateDropFiles([fakeFile('README')]);
  assert.equal(r.kind, 'unsupported');
});

test('validateDropFiles: multiple files, first is .json -> kind=ok-with-extras', () => {
  const first = fakeFile('save.json');
  const r = validateDropFiles([first, fakeFile('note.txt'), fakeFile('pic.png')]);
  assert.equal(r.kind, 'ok-with-extras');
  if (r.kind === 'ok-with-extras') {
    assert.equal(r.file, first);
    assert.equal(r.totalCount, 3);
  }
});

test('validateDropFiles: multiple files, first is non-JSON -> kind=unsupported', () => {
  const r = validateDropFiles([fakeFile('pic.png'), fakeFile('save.json')]);
  // Policy: only consider the first file, so if first isn't JSON, reject.
  assert.equal(r.kind, 'unsupported');
});

// -- hasFilesDragPayload ---------------------------------------------------

test('hasFilesDragPayload: DataTransfer.types array with "Files" -> true', () => {
  const dt = { types: ['Files'] } as unknown as DataTransfer;
  assert.equal(hasFilesDragPayload(dt), true);
});

test('hasFilesDragPayload: DataTransfer.types without "Files" -> false', () => {
  const dt = { types: ['text/plain', 'text/html'] } as unknown as DataTransfer;
  assert.equal(hasFilesDragPayload(dt), false);
});

test('hasFilesDragPayload: null DataTransfer -> false', () => {
  assert.equal(hasFilesDragPayload(null), false);
});

test('hasFilesDragPayload: DataTransferItemList-shaped types (contains("Files")) -> true', () => {
  const types = {
    contains: (s: string) => s === 'Files',
    length: 1,
    [0]: 'Files',
  };
  const dt = { types } as unknown as DataTransfer;
  assert.equal(hasFilesDragPayload(dt), true);
});
