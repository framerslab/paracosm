/**
 * Every email Paracosm sends carries a visible Unsubscribe link, the
 * RFC 8058 one-click headers and the sender's postal address, and the
 * link works: a GET only asks, a POST stops the mail at once, and no
 * email is sent about it.
 *
 * The mail goes through the real Resend SDK to a local stub of the Resend
 * API (as src/server/services/email.integration.test.ts does), and the
 * link is followed on the real dashboard server. RESEND_BASE_URL is set
 * before the SDK loads, so the modules under test are imported in
 * before(); node:test runs each test file in its own process.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as nodeModule from 'node:module';

interface SentMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

const sent: SentMail[] = [];
const stub = createServer((req, res) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    raw += chunk;
  });
  req.on('end', () => {
    sent.push(JSON.parse(raw) as SentMail);
    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
    res.end(JSON.stringify({ id: `msg_${sent.length}` }));
  });
});

const POSTAL = 'Example Sender LLC, 100 Test Street, Suite 1, Testville, NV 89000';
const LINK_BASE = 'https://paracosm.agentos.sh';
const TOKEN_IN_URL = /^https:\/\/paracosm\.agentos\.sh\/unsubscribe\?t=([A-Za-z0-9_-]{43})$/;

const prevBaseUrl = process.env.RESEND_BASE_URL;
const prevKey = process.env.RESEND_API_KEY;

type Modules = {
  sendOptionalEmail: typeof import('../../src/server/services/optional-mail.js').sendOptionalEmail;
  renderYoureIn: typeof import('../../src/server/services/email-templates.js').renderYoureIn;
  openMailStore: typeof import('../../src/server/stores/mail-suppression.js').openMailStore;
  mailDbPath: typeof import('../../src/server/stores/mail-suppression.js').mailDbPath;
  createMarsServer: typeof import('../../src/server/server-app.js').createMarsServer;
  resetClient: typeof import('../../src/server/services/email.js').__resetEmailClientForTests;
};
let m: Modules;

before(async () => {
  stub.listen(0, '127.0.0.1');
  await once(stub, 'listening');
  process.env.RESEND_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  process.env.RESEND_API_KEY = 're_unsubscribe_test';
  const optional = await import('../../src/server/services/optional-mail.js');
  const templates = await import('../../src/server/services/email-templates.js');
  const store = await import('../../src/server/stores/mail-suppression.js');
  const app = await import('../../src/server/server-app.js');
  const email = await import('../../src/server/services/email.js');
  m = {
    sendOptionalEmail: optional.sendOptionalEmail,
    renderYoureIn: templates.renderYoureIn,
    openMailStore: store.openMailStore,
    mailDbPath: store.mailDbPath,
    createMarsServer: app.createMarsServer,
    resetClient: email.__resetEmailClientForTests,
  };
  m.resetClient();
});

after(async () => {
  m?.resetClient();
  if (prevBaseUrl === undefined) delete process.env.RESEND_BASE_URL;
  else process.env.RESEND_BASE_URL = prevBaseUrl;
  if (prevKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = prevKey;
  stub.closeAllConnections();
  stub.close();
  await once(stub, 'close');
});

function sendNews(appDir: string, to: string, postalAddress = POSTAL) {
  return m.sendOptionalEmail({
    mailDbPath: m.mailDbPath(appDir),
    from: 'Paracosm <team@frame.dev>',
    replyTo: 'team@frame.dev',
    to,
    postalAddress,
    linkBase: LINK_BASE,
    render: (footer) => m.renderYoureIn({ email: to, name: 'Reader', ...footer }),
  });
}

/** The unsubscribe link of the newest mail, with its token. */
function newestLink(): { url: string; token: string } {
  const mail = sent[sent.length - 1];
  const header = mail.headers?.['List-Unsubscribe'] ?? '';
  const url = header.replace(/^<|>$/g, '');
  const match = TOKEN_IN_URL.exec(url);
  assert.ok(match, `List-Unsubscribe must hold one https one-click link, got: "${header}"`);
  return { url, token: match[1] };
}

async function withServer<T>(appDir: string, fn: (origin: string) => Promise<T>): Promise<T> {
  const env: NodeJS.ProcessEnv = { ...process.env, APP_DIR: appDir };
  delete env.PARACOSM_WAITLIST_STORE;
  const server = m.createMarsServer({ env, runPairSimulations: async () => {} });
  server.listen(0);
  await once(server, 'listening');
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

/** Follows a mailed link on the test server instead of the live site. */
function local(origin: string, url: string): string {
  return url.replace(LINK_BASE, origin);
}

function oneClick(url: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
}

test('the news email carries a visible Unsubscribe link, the one-click headers and the postal address', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-unsub-mail-'));
  try {
    sent.length = 0;
    assert.equal(await sendNews(appDir, 'reader@example.com'), 'sent');
    assert.equal(sent.length, 1);
    const mail = sent[0];
    const { url, token } = newestLink();

    assert.equal(mail.headers?.['List-Unsubscribe'], `<${url}>`, 'one https link and no mailto');
    assert.equal(mail.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

    // The visible link: an anchor whose text is Unsubscribe, set at 13 px or more.
    const anchor = new RegExp(`<a href="${url.replace(/[.?]/g, '\\$&')}"[^>]*>Unsubscribe</a>`);
    assert.match(mail.html, anchor, 'the HTML footer must link Unsubscribe to the same address as the header');
    const footer = mail.html.slice(mail.html.lastIndexOf('<tr><td', mail.html.indexOf('>Unsubscribe</a>')));
    for (const size of footer.matchAll(/font-size:\s*(\d+)px/g)) {
      assert.ok(Number(size[1]) >= 13, `footer text must be 13 px or more, found ${size[1]} px`);
    }
    assert.ok(mail.text.includes(`Unsubscribe: ${url}`), 'the plain-text part must carry the link');

    assert.ok(mail.html.includes(POSTAL), 'the HTML part must carry the postal address');
    assert.ok(mail.text.includes(POSTAL), 'the plain-text part must carry the postal address');

    // The token is kept only as a hash.
    const dataDir = join(appDir, 'data');
    for (const name of readdirSync(dataDir)) {
      assert.equal(readFileSync(join(dataDir, name)).includes(token), false, `${name} must not hold the raw token`);
    }
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('a GET on the link only asks; the one-click POST stops the mail at once and sends nothing', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-unsub-flow-'));
  try {
    sent.length = 0;
    assert.equal(await sendNews(appDir, 'reader@example.com'), 'sent');
    const first = newestLink();

    await withServer(appDir, async (origin) => {
      const ask = await fetch(local(origin, first.url));
      const page = await ask.text();
      assert.equal(ask.status, 200);
      assert.match(String(ask.headers.get('content-type')), /text\/html/);
      assert.match(String(ask.headers.get('x-robots-tag')), /noindex/);
      assert.match(String(ask.headers.get('cache-control')), /no-store/);
      assert.match(page, /<form method="post" action="\/unsubscribe\?t=[A-Za-z0-9_-]{43}">/);
      assert.match(page, /<button[^>]*>Unsubscribe<\/button>/);
      assert.match(page, /sends no account, sign-in or receipt email/, 'the page says nothing else keeps coming');

      // A link scanner's GET changes nothing: the next news email still goes.
      assert.equal(await sendNews(appDir, 'reader@example.com'), 'sent');
      assert.equal(sent.length, 2);

      const sentBefore = sent.length;
      const done = await oneClick(local(origin, first.url));
      assert.equal(done.status, 200);
      assert.match(await done.text(), /You are unsubscribed/);
      assert.equal(sent.length, sentBefore, 'no email is sent about an unsubscribe');

      // The address is suppressed at once, for every link it was sent.
      assert.equal(await sendNews(appDir, 'Reader@Example.com'), 'suppressed');
      assert.equal(sent.length, sentBefore, 'a suppressed address receives nothing');

      const again = await fetch(local(origin, newestLinkOf(1)));
      assert.equal(again.status, 200);
      assert.match(await again.text(), /This address is unsubscribed/);

      // The page's own button posts a form body; it records the same way.
      const button = await fetch(local(origin, first.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '',
      });
      assert.equal(button.status, 200);

      const put = await fetch(local(origin, first.url), { method: 'PUT' });
      assert.equal(put.status, 405);
      assert.match(String(put.headers.get('allow')), /GET/);
    });
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

/** The link of the n-th mail sent in this test (0-based). */
function newestLinkOf(index: number): string {
  const header = sent[index]?.headers?.['List-Unsubscribe'] ?? '';
  return header.replace(/^<|>$/g, '');
}

test('an unknown or malformed token answers 404 and records nothing, and a server that sent no mail creates no store', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-unsub-unknown-'));
  try {
    await withServer(appDir, async (origin) => {
      const unknown = `${origin}/unsubscribe?t=${'A'.repeat(43)}`;
      const get = await fetch(unknown);
      assert.equal(get.status, 404);
      assert.match(await get.text(), /not valid/);
      assert.equal((await oneClick(unknown)).status, 404);
      assert.equal((await oneClick(`${origin}/unsubscribe?t=%3Cscript%3E`)).status, 404);
      assert.equal((await fetch(`${origin}/unsubscribe`)).status, 404);
      assert.equal(existsSync(m.mailDbPath(appDir)), false, 'following a link must not create the mail store');
    });

    sent.length = 0;
    assert.equal(await sendNews(appDir, 'reader@example.com'), 'sent');
    await withServer(appDir, async (origin) => {
      assert.equal((await oneClick(`${origin}/unsubscribe?t=${'B'.repeat(43)}`)).status, 404);
    });
    assert.equal(await sendNews(appDir, 'reader@example.com'), 'sent', 'an unknown token suppresses nobody');
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('an address the operator suppressed gets no mail and no link, and a send without a postal address is refused', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-unsub-manual-'));
  try {
    const store = m.openMailStore({ dbPath: m.mailDbPath(appDir) });
    try {
      await store.suppress('Kept.Out@Example.com', 'manual');
    } finally {
      await store.close();
    }

    sent.length = 0;
    assert.equal(await sendNews(appDir, 'kept.out@example.com'), 'suppressed');
    assert.equal(sent.length, 0);

    await assert.rejects(sendNews(appDir, 'reader@example.com', '  '), /postal address/);
    assert.equal(sent.length, 0, 'commercial mail without the postal address must not go out');

    // A link base that is not an https origin would mail links the server does not answer.
    for (const linkBase of ['https://paracosm.agentos.sh/mail', 'http://paracosm.agentos.sh', '"https://paracosm.agentos.sh"']) {
      await assert.rejects(
        m.sendOptionalEmail({
          mailDbPath: m.mailDbPath(appDir),
          from: 'Paracosm <team@frame.dev>',
          to: 'reader@example.com',
          postalAddress: POSTAL,
          linkBase,
          render: (footer) => m.renderYoureIn({ email: 'reader@example.com', name: null, ...footer }),
        }),
        /https origin/,
        linkBase,
      );
    }
    assert.equal(sent.length, 0, 'an email with a broken unsubscribe link must not go out');
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test('a mail store that cannot be opened answers 503, leaves no unhandled rejection, and the server keeps answering', async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-unsub-broken-'));
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  try {
    mkdirSync(join(appDir, 'data'), { recursive: true });
    writeFileSync(m.mailDbPath(appDir), 'This file is plain text, not a SQLite database. '.repeat(40));
    await withServer(appDir, async (origin) => {
      const link = `${origin}/unsubscribe?t=${'C'.repeat(43)}`;
      assert.equal((await fetch(link)).status, 503);
      assert.equal((await oneClick(link)).status, 503);
      await new Promise((settle) => setTimeout(settle, 100));
      assert.deepEqual(rejections, [], 'a mail store that fails to open must not leave an unhandled rejection');
      assert.equal((await fetch(`${origin}/unsubscribe`)).status, 404, 'the server must keep answering');
    });
  } finally {
    process.off('unhandledRejection', onRejection);
    rmSync(appDir, { recursive: true, force: true });
  }
});

// module.registerHooks, which hides better-sqlite3 from the child, arrived in Node 22.15.
const canHideModules = typeof (nodeModule as { registerHooks?: unknown }).registerHooks === 'function';

test('the mail store refuses to open without better-sqlite3 instead of falling back to sql.js, which other processes cannot see', { skip: canHideModules ? false : 'needs module.registerHooks (Node 22.15 or newer)' }, async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'paracosm-unsub-engine-'));
  const storeUrl = pathToFileURL(resolve(import.meta.dirname, '..', '..', 'src/server/stores/mail-suppression.ts')).href;
  // A child process in which better-sqlite3 cannot load, as on a host without its native build.
  const program = `
    import { registerHooks } from 'node:module';
    registerHooks({
      resolve(specifier, context, next) {
        if (specifier === 'better-sqlite3' || specifier.startsWith('better-sqlite3/')) {
          throw Object.assign(new Error('better-sqlite3 is not available here'), { code: 'MODULE_NOT_FOUND' });
        }
        return next(specifier, context);
      },
    });
    const { openMailStore, mailDbPath } = await import(${JSON.stringify(storeUrl)});
    const store = openMailStore({ dbPath: mailDbPath(process.env.APP_DIR) });
    try {
      await store.suppress('person@example.com', 'manual');
      console.log('OPENED');
      process.exitCode = 0;
    } catch {
      console.log('REFUSED');
      process.exitCode = 3;
    } finally {
      await store.close().catch(() => {});
    }
  `;
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, APP_DIR: appDir };
    delete env.STORAGE_ADAPTER;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', program], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    const [status] = (await once(child, 'close')) as [number | null];
    assert.match(stdout, /REFUSED/, `the store must refuse to open; stdout: ${stdout} stderr: ${stderr.slice(-2000)}`);
    assert.equal(status, 3);
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});
