import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Paracosm dashboard E2E suite.
 *
 * Tests run against the production-style server at http://localhost:3456
 * (the same one shipped to paracosm.agentos.sh). The webServer block
 * builds the dashboard once and boots `npm run dashboard` so we exercise
 * the served bundle, not the dev-mode HMR variant.
 *
 * Override the target with `PARACOSM_E2E_BASE_URL` to point at a remote
 * deploy (e.g. PARACOSM_E2E_BASE_URL=https://paracosm.agentos.sh npm run test:e2e).
 */
export default defineConfig({
  testDir: './tests-e2e/specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.PARACOSM_E2E_BASE_URL ?? 'http://127.0.0.1:3456',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    // The Digital Twin and run status specs each hold one server whose runs
    // they read, so one project runs them: two at once would replace each
    // other's runs. So does the run-per-visitor spec, whose server caps how
    // many runs it holds.
    // So does the dashboard display spec, whose Library server counts the
    // replays its tests run. The toolbox log and share link spec, the forged
    // tool view spec, the Viz living grid spec, the Run tab's first screen
    // spec, the phone rows and grid window spec, the phone rows more spec, the
    // run view toast and Event Log chip spec and the Viz rows and type spec set
    // each width they check themselves, so one project runs them. So does
    // the saved run replay spec, which reads the one shared-run server.
    { name: 'chromium-tablet',  testIgnore: /digital-twin-events|run-status-events|run-per-visitor|dashboard-display|toolbox-log-and-share-link|forged-tool-view|viz-living-grid|sim-first-screen|phone-rows-and-grid-window|phone-rows-more|saved-run-replay|run-view-toast-and-log-chip|viz-rows-type/, use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    // Pixel 5 ships with the Chromium engine in Playwright's device
    // catalogue. iPhone 13 would force the webkit channel, which we
    // don't bundle (only chromium is installed via test:e2e:install).
    { name: 'chromium-mobile',  testIgnore: /digital-twin-events|run-status-events|run-per-visitor|dashboard-display|toolbox-log-and-share-link|forged-tool-view|viz-living-grid|sim-first-screen|phone-rows-and-grid-window|phone-rows-more|saved-run-replay|run-view-toast-and-log-chip|viz-rows-type/, use: { ...devices['Pixel 5'] } },
  ],
  webServer: process.env.PARACOSM_E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'npm run dashboard:build && PORT=3456 npx tsx src/cli/serve.ts',
          url: 'http://127.0.0.1:3456',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The same server with a stub Digital Twin engine, for the spec that
        // runs one: a run replaces its server's event buffer, so it gets a
        // server of its own.
        {
          command: 'PORT=3457 npx tsx tests-e2e/support/digital-twin-server.ts',
          url: 'http://127.0.0.1:3457',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The same server with a stub pair runner, for the spec that starts a
        // pair run from the page.
        {
          command: 'PORT=3458 npx tsx tests-e2e/support/pair-run-server.ts',
          url: 'http://127.0.0.1:3458',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The same server with admin writes on and a temporary scenarios
        // folder, for the spec that enters the admin token in Settings and
        // saves a scenario to disk.
        {
          command: 'PORT=3461 npx tsx tests-e2e/support/admin-write-server.ts',
          url: 'http://127.0.0.1:3461/health',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The same server with a scripted runner, for the spec that starts
        // real runs from several browsers at once through the real /setup.
        {
          command: 'PORT=3459 PARACOSM_MAX_RUNS=2 npx tsx tests-e2e/support/stub-runner-server.ts',
          url: 'http://127.0.0.1:3459/health',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The same server with three stored Mars Genesis runs in its Library,
        // for the spec that replays them and reads the replay counters.
        {
          command: 'PORT=3460 npx tsx tests-e2e/support/library-replay-server.ts',
          url: 'http://127.0.0.1:3460/health',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The same server with one finished pair run stored as a session and
        // listed in its Library, for the spec that presses a forged tool's log
        // key and the run's share controls, and the spec that picks the run
        // from the Run menu's saved runs.
        {
          command: 'PORT=3462 npx tsx tests-e2e/support/shared-run-server.ts',
          url: 'http://127.0.0.1:3462/health',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The same server with generated runs of 24 and 300 actors stored as
        // sessions, for the spec that opens forged tools at those sizes.
        {
          command: 'PORT=3467 npx tsx tests-e2e/support/cohort-run-server.ts',
          url: 'http://127.0.0.1:3467/health',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The same server with one finished Mars Genesis pair run stored as a
        // session, built from the engine's kernel and the hosted demo's
        // recorded words, for the spec that opens it in the Viz tab.
        {
          command: 'PORT=3466 npx tsx tests-e2e/support/viz-replay-server.ts',
          url: 'http://127.0.0.1:3466/health',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The hosted demo's server, with one run a day for each internet
        // address and a stub pair runner, for the Run tab's first screen spec;
        // a second port, 3472, answers what each run's snapshots held.
        {
          command: 'PORT=3470 npx tsx tests-e2e/support/first-screen-server.ts',
          url: 'http://127.0.0.1:3470/health',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The same server with stored Mars Genesis runs of 3, 24 and 300
        // leaders, one turn each from the engine's kernel, for the first
        // screen spec's cases that open a larger run on the Sim tab.
        {
          command: 'PORT=3471 npx tsx tests-e2e/support/cohort-replay-server.ts',
          url: 'http://127.0.0.1:3471/health',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The same server with one finished Mars Genesis pair run of six turns
        // stored as a session, for the spec that reads the run view's toasts
        // and the Event Log as it opens after a forged tool's Show in Event
        // Log and after a reload.
        {
          command: 'PORT=3468 npx tsx tests-e2e/support/six-turn-run-server.ts',
          url: 'http://127.0.0.1:3468/health',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The Viz tab's two stored runs with each turn's event_start frame, as
        // a live run sends it, so the Viz tab draws the event row the live
        // replays draw above the living grid, for the spec that lays out the
        // Viz tab on a phone and a short screen.
        {
          command: 'PORT=3473 VIZ_REPLAY_EVENT_STARTS=1 VIZ_REPLAY_HOSTED_CHROME=1 npx tsx tests-e2e/support/viz-replay-server.ts',
          url: 'http://127.0.0.1:3473/health',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        // The hosted demo's server with its visitor analytics on and made-up
        // ids, for the consent bar spec; the count events it forwards go to a
        // sink on port 3465.
        {
          command: 'PORT=3464 CONSENT_SINK_PORT=3465 npx tsx tests-e2e/support/consent-server.ts',
          url: 'http://127.0.0.1:3464/health',
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ],
});
