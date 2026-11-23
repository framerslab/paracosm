import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadJson } from './download.js';

test('downloadJson clicks an attached link and keeps the blob URL available for one second', async (t) => {
  const url = 'blob:record';
  const fileName = 'tool-trace.json';
  const json = '[{"actor":"A1"}]';
  const createUrl = t.mock.method(URL, 'createObjectURL', (_blob: Blob) => url);
  const revokeUrl = t.mock.method(URL, 'revokeObjectURL', (_url: string) => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });

  let attached = false;
  const link = {
    href: '',
    download: '',
    click: t.mock.fn(() => {
      assert.equal(attached, true);
      assert.equal(link.href, url);
      assert.equal(link.download, fileName);
      assert.equal(revokeUrl.mock.callCount(), 0);
    }),
    remove() {
      attached = false;
    },
  };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag: string) {
        assert.equal(tag, 'a');
        return link;
      },
      body: {
        append(element: typeof link) {
          assert.equal(element, link);
          attached = true;
        },
      },
    },
  });

  downloadJson(json, fileName);

  assert.equal(link.click.mock.callCount(), 1);
  assert.equal(attached, false);
  t.mock.timers.tick(999);
  assert.equal(revokeUrl.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(revokeUrl.mock.callCount(), 1);
  assert.deepEqual(revokeUrl.mock.calls[0].arguments, [url]);
  assert.equal(createUrl.mock.callCount(), 1);
  const [blob] = createUrl.mock.calls[0].arguments;
  if (!(blob instanceof Blob)) throw new TypeError('the link is made from a Blob');
  assert.equal(blob.type, 'application/json');
  assert.equal(await blob.text(), json);
});
