/**
 * Run from the manic-evidence Chrome profile (NOT the wilds-evidence profile).
 *
 * Pre-requisites (do these once, manually, in the manic profile):
 *   1. Launch Chrome with --user-data-dir=~/.manic-evidence-chrome-profile
 *      and log into Discord as the `manic` account.
 *   2. Manually JOIN each target server (Discord > Discover > search the name,
 *      or use a public invite link). The script does NOT auto-join — joining
 *      is a sensitive action and should be a deliberate manual click.
 *   3. Once joined, run this script.
 *
 * What it does:
 *   - Verifies the script is running against the manic profile (not wilds)
 *   - For each target server, checks membership, then runs keyword searches
 *     via Discord's in-app search bar across the whole guild
 *   - Screenshots each search result page
 *   - Writes structured findings to JSON
 *   - Does NOT auto-leave the servers (manual cleanup so you control timing)
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PROFILE = `${process.env.HOME}/.manic-evidence-chrome-profile`;
const OUT     = `${process.env.HOME}/Documents/abuse-investigation/scammers/source-server-search-manic`;

if (!existsSync(PROFILE)) {
  console.error(`!! Manic profile does not exist at ${PROFILE}`);
  console.error('   Step 1: launch Chrome once with that --user-data-dir and log in to Discord as manic.');
  console.error('   Step 2: join the 3 target servers manually.');
  console.error('   Step 3: re-run this script.');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const SERVERS = [
  { tag: 'M.AI', guildId: '1144547040454508606', name: 'Mistral AI',         displayedBy: 'actor-a'  },
  { tag: 'CDEX', guildId: '1438605022379249767', name: 'Cricdex',            displayedBy: 'actor-b'   },
  { tag: 'CODE', guildId: '613425648685547541',  name: 'Discord Developers', displayedBy: 'actor-c' },
];

const QUERIES = [
  'wilds.ai', 'wilds', 'agentos', 'framers', 'framerslab', 'rabbithole',
  'rabbithole.inc', 'trojanos', 'johnny dunn', 'johnnyddunn', 'jddunn',
  'ayeeye', 'aye eye',
  'scammer community', 'fucking scammer', 'paid for stars',
];

let totalShots = 0;
async function shot(page, label) {
  totalShots++;
  const path = join(OUT, `${String(totalShots).padStart(3,'0')}-${label}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function dismissModals(page) {
  for (let i = 0; i < 4; i++) {
    const did = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return false;
      const ok = Array.from(dlg.querySelectorAll('button')).find(b =>
        /^(okay|ok|got it|close|continue|maybe later|not now|no thanks|skip)$/i.test((b.textContent || '').trim())
      );
      if (ok) { ok.click(); return true; }
      return false;
    });
    if (!did) break;
    await page.waitForTimeout(300);
  }
}

async function isMember(page, guildId) {
  await page.goto(`https://discord.com/channels/${guildId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await dismissModals(page);
  const url = page.url();
  if (url.includes('/channels/@me') || url.includes('/invite/') || url.includes('/login')) {
    return { member: false, reason: 'redirected', url };
  }
  const hasJoinUI = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).some(b =>
      /^(accept invite|join server|continue to discord)$/i.test((b.textContent || '').trim())
    )
  );
  if (hasJoinUI) return { member: false, reason: 'join-button-visible', url };
  const hasChannelList = await page.evaluate(() =>
    !!document.querySelector('[data-list-id="channels"]') ||
    !!document.querySelector('nav[aria-label*="Channels" i]')
  );
  return { member: hasChannelList, reason: hasChannelList ? 'channels-visible' : 'no-channels', url };
}

async function search(page, query) {
  const found = await page.evaluate(() => {
    const i = document.querySelector('input[placeholder*="Search" i]') ||
              document.querySelector('input[aria-label*="Search" i]');
    if (i) { i.focus(); return true; }
    return false;
  });
  if (!found) { await page.keyboard.press('Meta+F'); await page.waitForTimeout(500); }
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(query, { delay: 30 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await dismissModals(page);
  return await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[id^="search-results-"] [id^="chat-messages-"], [id^="chat-messages-"]'));
    return items.slice(0, 50).map(el => ({
      id: el.id || null,
      time: el.querySelector('time')?.getAttribute('datetime') || null,
      author: el.querySelector('[class*="username"]')?.textContent?.trim() || null,
      content: el.querySelector('[id^="message-content"]')?.textContent?.trim() || null,
    })).filter(r => r.content);
  });
}

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    executablePath: '/Users/johnn/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  // Identity self-check: pull /api/v10/users/@me equivalent via DOM after navigating
  await page.goto('https://discord.com/channels/@me', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await dismissModals(page);
  await shot(page, 'identity-check');
  console.log('Identity check screenshot saved. CONFIRM the avatar/username in the bottom-left is the manic account before continuing.');

  const findings = { generated_at: new Date().toISOString(), profile: PROFILE, servers: [] };

  for (const srv of SERVERS) {
    console.log(`\n=== ${srv.name} (${srv.guildId}) ===`);
    const entry = { ...srv, queries: [] };
    const mship = await isMember(page, srv.guildId);
    entry.member = mship.member;
    entry.member_reason = mship.reason;
    console.log(`  membership: ${mship.member ? 'YES' : 'NO'} (${mship.reason})`);
    await shot(page, `${srv.tag}-landing`);

    if (!mship.member) {
      console.log('  -> SKIP: not a member. Join manually then re-run.');
      findings.servers.push(entry);
      continue;
    }

    for (const q of QUERIES) {
      try {
        const r = await search(page, q);
        const sp = await shot(page, `${srv.tag}-${q.replace(/[^a-z0-9]+/gi,'_')}`);
        entry.queries.push({ query: q, count: r.length, results: r, screenshot: sp });
        console.log(`  "${q}" -> ${r.length} hits`);
      } catch (e) {
        entry.queries.push({ query: q, error: e.message });
        console.log(`  "${q}" -> ERROR ${e.message}`);
      }
      await page.waitForTimeout(1500);
    }
    findings.servers.push(entry);
  }

  writeFileSync(join(OUT, 'findings.json'), JSON.stringify(findings, null, 2));
  console.log(`\nDone. ${totalShots} screenshots + findings.json saved to ${OUT}`);
  console.log('Reminder: manually leave the 3 servers if you want zero persistent footprint.');

  await ctx.close();
}

main().catch(e => { console.error(e); process.exit(1); });
