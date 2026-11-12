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
    // replays its tests run.
    { name: 'chromium-tablet',  testIgnore: /digital-twin-events|run-status-events|run-per-visitor|dashboard-display/, use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    // Pixel 5 ships with the Chromium engine in Playwright's device
    // catalogue. iPhone 13 would force the webkit channel, which we
    // don't bundle (only chromium is installed via test:e2e:install).
    { name: 'chromium-mobile',  testIgnore: /digital-twin-events|run-status-events|run-per-visitor|dashboard-display/, use: { ...devices['Pixel 5'] } },
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
      ],
});
