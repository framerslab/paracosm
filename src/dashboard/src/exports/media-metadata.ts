import type { RunProvenance } from '../../../engine/schema/index.js';

export const PROVENANCE_NS = 'https://paracosm.agentos.sh/ns/provenance/1.0/';
export const IPTC_NS = 'http://iptc.org/std/Iptc4xmpExt/2008-02-29/';
const DIGITAL_SOURCE = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';
const XMP_KEY = 'XML:com.adobe.xmp';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function xmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function makeProvenanceXmp(provenance: RunProvenance): string {
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="${IPTC_NS}" xmlns:paracosm="${PROVENANCE_NS}">
<Iptc4xmpExt:DigitalSourceType rdf:resource="${DIGITAL_SOURCE}"/>
<paracosm:provenance>${xmlText(JSON.stringify(provenance))}</paracosm:provenance>
</rdf:Description></rdf:RDF></x:xmpmeta>`;
}

function xmpChunk(provenance: RunProvenance): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const payload = encoder.encode(`${XMP_KEY}\0\0\0\0\0${makeProvenanceXmp(provenance)}`);
  const chunk = new Uint8Array(payload.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set(encoder.encode('iTXt'), 4);
  chunk.set(payload, 8);
  let crc = 0xffffffff;
  for (const value of chunk.subarray(4, chunk.length - 4)) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

export async function markRunPng(png: Blob, provenance: RunProvenance): Promise<Blob> {
  const bytes = new Uint8Array(await png.arrayBuffer());
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) throw new Error('Invalid PNG signature');
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  const parts: BlobPart[] = [bytes.subarray(0, 8)];
  let inserted = false;
  let offset = 8;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new Error('Truncated PNG chunk');
    const length = view.getUint32(offset);
    const next = offset + length + 12;
    if (next > bytes.length) throw new Error('Truncated PNG chunk');
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    if (!inserted && type === 'IDAT') {
      parts.push(xmpChunk(provenance));
      inserted = true;
    }
    const xmp = ['iTXt', 'tEXt', 'zTXt'].includes(type) && length > XMP_KEY.length
      && decoder.decode(bytes.subarray(offset + 8, offset + 8 + XMP_KEY.length + 1)) === XMP_KEY + '\0';
    if (!xmp) parts.push(bytes.subarray(offset, next));
    offset = next;
  }
  if (!inserted) throw new Error('PNG does not contain image data');
  return new Blob(parts, { type: 'image/png' });
}
