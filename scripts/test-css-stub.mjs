/**
 * Test-only module hooks that stand in for what Vite handles in the
 * dashboard build. `.scss` / `.css` / `.module.scss` imports resolve to
 * a class-name Proxy and `?url` asset imports to an empty string. The
 * viz-kit React components import their SCSS modules directly, and
 * `pdf-extract.ts` imports the pdfjs worker with `?url`; node:test can
 * load neither. Production builds resolve them via Vite (the dashboard
 * dev / build commands), unaffected by this test-only shim.
 *
 * Wire-up: `node --import tsx --import ./scripts/test-css-stub.mjs --test ...`
 *
 * The stubs must run before tsx's own hooks. tsx removes the query
 * from a specifier before it passes the request on, so a hook behind
 * it never sees `?url` and the real worker file loads instead of the
 * stub. Where Node has `module.registerHooks()` the stubs are
 * registered with it, in-thread, as tsx registers its hooks on current
 * Node: in-thread hooks run before off-thread ones, and among them the
 * last registered runs first, so loading this file after tsx puts the
 * stubs ahead. On a Node without `registerHooks()` both use the
 * off-thread `module.register()`, with the same last-registered order.
 */
import nodeModule from 'node:module';

import { load, resolve } from './test-css-stub-loader.mjs';

if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve, load });
} else {
  nodeModule.register('./test-css-stub-loader.mjs', import.meta.url);
}
