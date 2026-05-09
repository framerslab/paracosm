import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('mobile contracts: TabBar is CSS responsive and has no viewport-driven inline styles', () => {
  const component = read('./components/layout/TabBar.tsx');
  const styles = read('./components/layout/TabBar.module.scss');
  const tokens = read('./theme/tokens.css');

  assert.ok(!component.includes('window.innerWidth'), 'TabBar must not branch on window.innerWidth');
  assert.ok(!component.includes('style={{'), 'TabBar layout should live in its SCSS module');
  assert.ok(component.includes("from './TabBar.module.scss'"), 'TabBar imports its SCSS module');
  assert.match(styles, /@media\s*\(max-width:\s*900px\)/, 'TabBar has a tablet/mobile breakpoint');
  assert.match(styles, /min-width:\s*44px/, 'TabBar keeps a 44px touch-target floor');
  assert.ok(!styles.includes('min-width: 36px'), 'TabBar module must not shrink below 44px');
  assert.ok(!tokens.includes('.tab-bar button { min-width: 36px'), 'global phone rules must not shrink tabs below 44px');
  assert.match(styles, /\.icon/, 'TabBar can expose icons in compact CSS layout');
  assert.match(styles, /\.label/, 'TabBar can hide labels in compact CSS layout');
});

test('mobile contracts: RunTable exposes labels and card-like phone layout', () => {
  const component = read('./components/library/RunTable.tsx');
  const styles = read('./components/library/RunTable.module.scss');

  assert.ok(component.includes('className={styles.wrapper}'), 'RunTable has a scroll/card wrapper');
  assert.match(component, /data-label="Scenario"/, 'scenario cell has mobile label');
  assert.match(component, /data-label="Started"/, 'started cell has mobile label');
  assert.match(styles, /@media\s*\(max-width:\s*720px\)/, 'RunTable has a phone breakpoint');
  assert.match(styles, /td::before/, 'RunTable phone cells render their data-label');
  assert.match(styles, /display:\s*block/, 'RunTable can switch rows/cells to block layout');
});

test('mobile contracts: viz drawers become phone-safe panels', () => {
  const gridSettings = read('./components/viz/grid/GridSettingsDrawer.module.scss');
  const roster = read('./components/viz/grid/RosterDrawer.module.scss');

  assert.match(gridSettings, /@media\s*\(max-width:\s*600px\)/, 'settings drawer has phone breakpoint');
  assert.match(gridSettings, /bottom:\s*0/, 'settings drawer docks to bottom on phones');
  assert.match(gridSettings, /max-height:\s*min\(70dvh,\s*520px\)/, 'settings drawer uses dynamic viewport height');

  assert.match(roster, /@media\s*\(max-width:\s*600px\)/, 'roster drawer has phone breakpoint');
  assert.match(roster, /bottom:\s*0/, 'roster drawer docks to bottom on phones');
  assert.match(roster, /max-height:\s*min\(72dvh,\s*560px\)/, 'roster drawer uses dynamic viewport height');
});

test('mobile contracts: app shell uses dynamic viewport units for phone browser chrome', () => {
  const app = read('./App.module.scss');
  const tokens = read('./theme/tokens.css');

  assert.match(app, /height:\s*100dvh/, 'app shell height tracks the dynamic viewport');
  assert.match(app, /min-height:\s*100dvh/, 'error fallback uses dynamic viewport height');
  assert.match(tokens, /min-height:\s*100dvh/, 'body has dynamic viewport min-height');
  assert.match(tokens, /translateY\(100dvh\)/, 'scanline animation uses dynamic viewport height');
});

test('mobile contracts: topbar logo references served assets', () => {
  const topbar = read('./components/layout/TopBar.tsx');

  assert.ok(!topbar.includes('/brand/icons/'), 'TopBar must not reference missing /brand/icons assets');
  assert.ok(topbar.includes('/favicon.svg'), 'TopBar uses the dashboard-served favicon asset');
});

test('mobile contracts: quickstart loaded scenario panel cannot exceed phone width', () => {
  const seedInput = read('./components/quickstart/SeedInput.module.scss');
  const loadedCta = read('./components/quickstart/LoadedScenarioCTA.module.scss');

  assert.match(seedInput, /width:\s*min\(100%,\s*640px\)/, 'seed input constrains itself to the viewport');
  assert.match(seedInput, /min-width:\s*0/, 'seed input can shrink inside the flex column');
  assert.match(loadedCta, /min-width:\s*0/, 'loaded CTA can shrink inside the seed panel');
  assert.match(loadedCta, /overflow-wrap:\s*anywhere/, 'loaded CTA text can wrap on phones');
  assert.match(loadedCta, /\.runButtonCompact/, 'loaded CTA has a short phone label');
  assert.match(loadedCta, /\.runButtonFull/, 'loaded CTA keeps the full desktop label');
  assert.match(loadedCta, /@media\s*\(max-width:\s*480px\)/, 'loaded CTA has a phone-specific density breakpoint');
});
