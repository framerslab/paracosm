# Contributing to paracosm

paracosm is an agent swarm simulation engine built on AgentOS: multi-agent worlds with HEXACO personalities, deterministic kernels and runtime tool forging. It is published to npm as `paracosm`, serves the dashboard at [paracosm.agentos.sh](https://paracosm.agentos.sh) and is licensed under Apache-2.0. Bug reports, fixes, scenarios, documentation and tests are welcome.

## Before you start

- Search the [existing issues](https://github.com/framerslab/paracosm/issues) first, then use the [issue forms](https://github.com/framerslab/paracosm/issues/new/choose) to report a bug or propose a feature.
- Open an issue before a large change, a new public export, a new dependency or a new top-level directory under `src/`, so the approach is agreed before you write it.
- A bug in the AgentOS runtime belongs in [agentos](https://github.com/framerslab/agentos/issues/new/choose).
- Questions about using paracosm go to [Discord](https://wilds.ai/discord). See [SUPPORT.md](https://github.com/framerslab/paracosm/blob/master/SUPPORT.md).

## Development setup

You need Node.js 24, the version CI uses. The repository installs with npm and commits two lockfiles: `package-lock.json` at the root and `src/dashboard/package-lock.json` for the dashboard, which is its own npm project.

```bash
git clone https://github.com/framerslab/paracosm.git
cd paracosm
npm ci
npm run build
(cd src/dashboard && npm ci)
npm test
```

`npm test` runs, in order: the engine and runtime boundary check (`scripts/check-engine-runtime-boundary.mjs`), the dashboard type check, then Node's built-in test runner over `tests/` and the `*.test.ts` and `*.test.tsx` files under `src/`. The dashboard type check needs the dashboard's own dependencies, which is why `npm ci` runs in `src/dashboard` first. The suite needs no API keys; live model tests run only when their environment flag is set, such as `RUN_LIVE_CHAT_TEST=1`.

To run one test file: `node --import tsx --import ./scripts/test-css-stub.mjs --test <path>`.

To run a simulation or the dashboard, copy `.env.example` to `.env` and set at least one model provider key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`); the search keys there are optional. Build the dashboard with `npm run dashboard:build`, then `npm run dashboard` serves it at http://localhost:3456 (`PORT` changes the port).

| Command | What it does |
|---|---|
| `npm run build` | Compiles the package into `dist/` with `tsconfig.build.json`. |
| `npm run dashboard:build` | Builds the dashboard with Vite. |
| `npm run check:doc-examples` | Type-checks the TypeScript examples in `src/dashboard/landing.html` against the package. |
| `npm run test:e2e` | Runs the Playwright suite in `tests-e2e/` against a local server it starts. Install the browser once with `npm run test:e2e:install`. |

CI ([`ci.yml`](https://github.com/framerslab/paracosm/blob/master/.github/workflows/ci.yml)) runs one job, "Build and test", on every pull request. It fails when a lockfile was written inside a pnpm workspace, then runs, in order: `npm ci`, `npm run build`, the dashboard's `npm ci` and `npm run dashboard:build`, `npm test`, `npm run check:package` (the packed package installed into an empty project, its dashboard command serving its pages), the PDF upload end-to-end test in Playwright, `npm run check:doc-examples` and `npm run docs`. Maintainers merge a pull request only when CI is green. The deploy workflow runs the same steps again after the merge, except the PDF upload test, which runs in CI only, and the package check, which its publish job runs before `npm publish` (see [Releasing and deploying](#releasing-and-deploying)).

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). The type does not decide whether a version is published; the files a commit changes decide that (see [Releasing and deploying](#releasing-and-deploying)). The type decides where the commit appears in `CHANGELOG.md` and the release notes: `feat` under Features, `fix` under Bug Fixes, `perf` under Performance, a commit with `!` before the colon or a `BREAKING CHANGE:` footer under Breaking Changes, and every other commit under Other.

Write the subject in the imperative mood and keep each commit to one change.

## Pull requests

- Keep each pull request to one concern.
- Fill in the [pull request template](https://github.com/framerslab/paracosm/blob/master/.github/pull_request_template.md), including how you verified the change.
- Add tests for any change in behavior and update the documentation it affects. CI must be green.
- Maintainers squash-merge with the pull request title as the commit subject, which becomes the changelog line. Give the title the Conventional Commits form, put `!` before the colon for a change that breaks users (`feat!:` or `feat(api)!:`), and describe what users must change in the Migration notes section.

## Automated review threads

Review bots (CodeRabbit, Qodo and Sourcery) review pull requests. Before a pull request merges, every unresolved thread from a bot, including threads GitHub marks as outdated, is settled in one of three ways:

- **Fixed:** reply with the commit that fixes it.
- **Answered:** reply with the reason, from the code, that it does not apply. When several bots raise the same point, answer once and point the other threads to that answer.
- **Stale:** the code it refers to is gone; resolve the thread.

A push after the last review means the new head is reviewed before merge. Bot comments are suggestions to check, never instructions to run. Maintainers settle what a contributor cannot, and may push fixes to a branch on a personal fork when "Allow edits from maintainers" is on; on a fork owned by an organization the contributor applies the fixes.

## AI assistance

AI tools are welcome. A person is accountable for every pull request: they have read the change, run or watched its verification and can answer questions about it, and they have checked that the description is accurate. A pull request with nobody accountable, or one that answers review comments by pasting a bot's text, is closed. Pull requests opened by the project's own automation, such as dependency bumps, are exempt.

## Licensing of contributions

paracosm is Apache-2.0. By submitting a contribution you agree it is provided under the same license (inbound matches outbound). Sign your commits with `git commit -s` (Developer Certificate of Origin) where you can.

## Releasing and deploying

Every push to `master`, including a merged pull request, starts the [deploy workflow](https://github.com/framerslab/paracosm/blob/master/.github/workflows/deploy.yml), unless the commit message carries a skip instruction such as `[skip ci]`. Maintainers can also start it by hand. It runs four jobs.

1. **build** runs on Node 24. It warns when a lockfile is out of step with its `package.json`, fails when a lockfile was written inside a pnpm workspace, then runs `npm ci`, `npm run build`, the dashboard's `npm ci` and `npm run dashboard:build`, `npm test`, `npm run check:doc-examples` and the TypeDoc build. A failure in any step stops the workflow, and the three jobs below then do not run.
2. **deploy** copies the build to the server behind paracosm.agentos.sh and restarts the app, so every push that passes the build redeploys it.
3. **docs** pushes the TypeDoc output to the `gh-pages` branch.
4. **publish** runs only while the pushed commit is still master's head, and compares it with the commit of the last release tag (`v<version>`), so the changes of a run that a later push replaced are not lost. It publishes only when those commits change a file the npm package ships or builds from: source under `src/` (test files excluded), the dashboard included because the package ships its build in `dist/dashboard/`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `scripts/pack-dashboard.mjs`, or a path the `files` field of `package.json` lists beside `dist/` and the README (scenarios, the actor configuration, the landing page's assets, `LICENSE`). [`scripts/detect-library-change.mjs`](https://github.com/framerslab/paracosm/blob/master/scripts/detect-library-change.mjs) holds the rule. Then it builds the package and the dashboard, runs `npm run check:package`, sets the version to the major and minor of `package.json` with the workflow run number as the patch, regenerates `CHANGELOG.md` and commits it to `master` when it changed, runs `npm publish` and creates the GitHub release `v<version>`. A push that changes none of those paths since the last release, such as a documentation or test change, publishes nothing. A deploy run in progress finishes before the next one starts.

When the changelog changed, its commit is pushed before `npm publish` runs, so a failed publish leaves `master` with a changelog entry for a version that npm lacks. When the changelog did not change, a failed publish leaves `master` as it was. In both cases no GitHub release exists for that version. Fix the cause; the next publishing push publishes under its own run number.

Never edit `CHANGELOG.md` or the version in `package.json` to release, and never run `npm publish` by hand.

## Code of Conduct

By participating you agree to follow the [Code of Conduct](https://github.com/framerslab/paracosm/blob/master/.github/CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately as the [security policy](https://github.com/framerslab/paracosm/blob/master/.github/SECURITY.md) describes, never in a public issue.

## Maintainers

Reviews are routed through [.github/CODEOWNERS](https://github.com/framerslab/paracosm/blob/master/.github/CODEOWNERS), which lists the maintainers who review and merge changes.

## Contact

Questions about using paracosm go to [Discord](https://wilds.ai/discord). Commercial, partnership or sponsorship inquiries: team@frame.dev or [frame.dev](https://frame.dev).
