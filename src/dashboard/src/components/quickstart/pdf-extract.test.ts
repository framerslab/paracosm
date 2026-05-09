import test from 'node:test';
import assert from 'node:assert/strict';

import { extractPdfText } from './pdf-extract.js';

test('extractPdfText: rejects non-PDF file by extension + MIME', async () => {
  const fakeFile = {
    name: 'sheet.xlsx',
    type: 'application/vnd.ms-excel',
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as File;
  await assert.rejects(() => extractPdfText(fakeFile), /not a PDF/);
});
