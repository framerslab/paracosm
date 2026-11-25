import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markRunPng, makeProvenanceXmp } from '../../../src/dashboard/src/exports/media-metadata.js';
import { makeRunProvenance } from '../../../src/engine/schema/provenance.js';

const provenance = makeRunProvenance({ commander: 'équipe<&>測試' });
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const fixture = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));

function chunks(bytes: Uint8Array) {
  const types: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset < bytes.length) {
    types.push(new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)));
    offset += view.getUint32(offset) + 12;
  }
  assert.equal(offset, bytes.length);
  return types;
}

test('one PNG metadata packet survives repeated marking with the same image chunks', async () => {
  const marked = await markRunPng(new Blob([fixture], { type: 'image/png' }), provenance);
  const twice = await markRunPng(marked, provenance);
  const bytes = new Uint8Array(await marked.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 8)], signature);
  assert.deepEqual(chunks(bytes), ['IHDR', 'iTXt', 'IDAT', 'IEND']);
  assert.deepEqual(new Uint8Array(await twice.arrayBuffer()), bytes);
  assert.ok(new TextDecoder().decode(bytes).includes(makeProvenanceXmp(provenance)));
  assert.ok(Buffer.from(bytes).subarray(bytes.length - (fixture.length - 33)).equals(Buffer.from(fixture).subarray(33)));
});

test('XMP retains empty model assignments and escapes Unicode data for XML', () => {
  assert.match(makeProvenanceXmp(provenance), /équipe&lt;&amp;&gt;測試/);
  assert.match(makeProvenanceXmp(makeRunProvenance({})), /"models":\{\}/);
});
