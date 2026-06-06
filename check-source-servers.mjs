/**
 * Check the 3 source servers (where banned scammers display clan tags) for
 * any defamation / mentions of wilds.ai / agentos / Johnny.
 *
 * Servers (clan tag → guild ID):
 *   M.AI  = Mistral AI         (1144547040454508606)
 *   CDEX  = Cricdex            (1438605022379249767)
 *   CODE  = Discord Developers (613425648685547541)
 *
 * For each: detect membership, run a sequence of keyword searches via Ctrl+F,
 * screenshot every result page, and dump structured findings to JSON.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = `${process.env.HOME}/Documents/abuse-investigation/scammers/source-server-search`;
const PROFILE = `${process.env.HOME}/.agentos-evidence-chrome-profile`;
mkdirSync(OUT, { recursive: true });

const SERVERS = [
  { tag: 'M.AI', guildId: '1144547040454508606', name: 'Mistral AI',         displayedBy: 'actor-a' },
  { tag: 'CDEX', guildId: '1438605022379249767', name: 'Cricdex',            displayedBy: 'actor-b' },
  { tag: 'CODE', guildId: '613425648685547541',  name: 'Discord Developers', displayedBy: 'actor-c' },
];

const QUERIES = [
  'wilds.ai', 'wilds', 'agentos', 'framers', 'framerslab', 'rabbithole',
  'trojanos', 'johnny dunn', 'johnnyddunn', 'ayeeye', 'aye eye',
  'scammer', 'scam', 'fucking scammer', 'jddunn',
];

const findings = {
  generated_at: new Date().toISOString(),
  servers: [],
};

let totalShots = 0;
async function shot(page, label) {
  totalShots++;
  const path = join(OUT, `${String(totalShots).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function dismissModals(page) {
  for (let i = 0; i < 4; i++) {
    const did = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return false;
      const ok = Array.from(dlg.querySelectorAll('button')).find(b =>
        /^(okay|ok|got it|close|continue|maybe later|not now|no thanks)$/i.test((b.textContent || '').trim())
      );
      if (ok) { ok.click(); return true; }
      return false;
    });
    if (!did) break;
    await page.waitForTimeout(300);
  }
}

async function isMember(page, guildId) {
  // Try to navigate to a guild's root. If we're a member, the channel list loads
  // and the URL stabilises at /channels/<gid>/<channel_id>. If we're not, Discord
  // shows an invite/join overlay or redirects to @me.
  const target = `https://discord.com/channels/${guildId}`;
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await dismissModals(page);
  const url = page.url();
  if (url.includes('/channels/@me') || url.includes('/invite/') || url.includes('/login')) {
    return { member: false, finalUrl: url, reason: 'redirected-out-of-guild' };
  }
  // Check for join/invite button on page
  const hasJoinUI = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.some(b => /^(accept invite|join server|continue to discord)$/i.test((b.textContent || '').trim()));
  });
  if (hasJoinUI) return { member: false, finalUrl: url, reason: 'join-button-visible' };
  // Check for server name in title bar / sidebar
  const hasChannelList = await page.evaluate(() =>
    !!document.querySelector('[data-list-id="channels"]') ||
    !!document.querySelector('[aria-label*="Channels" i]') ||
    !!document.querySelector('nav[aria-label*="Channels" i]')
  );
  return { member: hasChannelList, finalUrl: url, reason: hasChannelList ? 'channels-visible' : 'no-channels' };
}

async function runSearch(page, guildId, query) {
  // Open Discord search via the search bar input
  // Discord exposes a search input in the toolbar; activate via Cmd+F (Mac) or via UI
  const found = await page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="Search" i]') ||
                  document.querySelector('input[type="text"][aria-label*="Search" i]');
    if (input) { input.focus(); return true; }
    return false;
  });
  if (!found) {
    // fallback: Cmd+F shortcut
    await page.keyboard.press('Meta+F');
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(400);
  // Clear and type query
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(query, { delay: 30 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await dismissModals(page);

  // Extract message-like result items
  const results = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[id^="search-results-"] [id^="chat-messages-"], [id^="chat-messages-"]'));
    return items.slice(0, 30).map(el => {
      const time = el.querySelector('time')?.getAttribute('datetime') || null;
      const author = el.querySelector('[class*="username"]')?.textContent?.trim() || null;
      const content = el.querySelector('[id^="message-content"]')?.textContent?.trim() || null;
      return { id: el.id || null, time, author, content };
    }).filter(r => r.content);
  });

  return results;
}

async function main() {
  console.log('Launching evidence profile...');
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    executablePath: '/Users/johnn/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  for (const srv of SERVERS) {
    console.log(`\n=== ${srv.name} (${srv.guildId}, tag=${srv.tag}) ===`);
    const entry = { ...srv, member: null, member_reason: null, queries: [] };
    const mship = await isMember(page, srv.guildId);
    entry.member = mship.member;
    entry.member_reason = mship.reason;
    entry.final_url_on_navigate = mship.finalUrl;
    console.log(`  membership: ${mship.member ? 'MEMBER' : 'NOT MEMBER'} (${mship.reason})`);
    await shot(page, `${srv.tag}-landing`);

    if (mship.member) {
      for (const q of QUERIES) {
        console.log(`  search: ${q}`);
        try {
          const results = await runSearch(page, srv.guildId, q);
          const shotPath = await shot(page, `${srv.tag}-${q.replace(/[^a-z0-9]+/gi, '_')}`);
          entry.queries.push({ query: q, results, screenshot: shotPath });
          console.log(`    -> ${results.length} results`);
        } catch (e) {
          console.log(`    !! error: ${e.message}`);
          entry.queries.push({ query: q, error: e.message });
        }
        await page.waitForTimeout(1200);
      }
    } else {
      console.log('  -> skipping searches (not a member)');
    }
    findings.servers.push(entry);
  }

  const out = join(OUT, 'findings.json');
  writeFileSync(out, JSON.stringify(findings, null, 2));
  console.log(`\nDone. ${totalShots} screenshots saved.`);
  console.log(`JSON: ${out}`);

  await ctx.close();
}

main().catch(e => { console.error(e); process.exit(1); });
