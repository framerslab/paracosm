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

To run a simulation or the dashboard, copy `.env.example` to `.env` and set at least one model provider key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`); the search keys there are optional. Build the dashboard with `npm run dashboard:build`, then `npm run dashboard` serves it at http://localhost:3456 (`PORT` changes the port; it listens on `127.0.0.1` unless `HOST` names another address).

| Command | What it does |
|---|---|
| `npm run build` | Compiles the package into `dist/` with `tsconfig.build.json`. |
| `npm run dashboard:build` | Builds the dashboard with Vite. |
| `npm run check:doc-examples` | Type-checks the TypeScript examples in `src/dashboard/landing.html` against the package. |
| `npm run test:e2e` | Runs the Playwright suite in `tests-e2e/` against a local server it starts. Install the browser once with `npm run test:e2e:install`. |

CI ([`ci.yml`](https://github.com/framerslab/paracosm/blob/master/.github/workflows/ci.yml)) runs five jobs on every pull request. "Build and test" installs and builds the server and dashboard, runs the tests, checks the packed package (including its `/health` version) on Node 24 and Node 22, runs the Playwright checks, checks the doc examples and builds the API docs and sitemap. "Server install" runs `npm ci --omit=dev --no-audit --no-fund` on Node 22 without a toolchain. "Compiled server" compiles after an install with lifecycle scripts disabled. "Deploy keeps host data" runs the deploy's copy and remote script against a stand-in host, checking data retention, locked retries, service ownership and private configuration access. "Deploy pins the host key" checks matching, different and empty keys against a disposable SSH server on loopback. Maintainers merge a pull request only when CI is green. The deploy workflow repeats the build checks after merge; its package-check job checks the tarball publish ships (see [Releasing and deploying](#releasing-and-deploying)).

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

Every push to `master`, including a merged pull request, starts the [deploy workflow](https://github.com/framerslab/paracosm/blob/master/.github/workflows/deploy.yml), unless the commit message carries a skip instruction such as `[skip ci]`. Maintainers can also start it by hand. It runs six jobs.

1. **build** runs on Node 24. It warns when a lockfile is out of step with its `package.json`, fails when a lockfile was written inside a pnpm workspace, then runs `npm ci`, `npm run build`, the dashboard's `npm ci` and `npm run dashboard:build`, `node scripts/pack-dashboard.mjs`, `npm test`, `npm run check:doc-examples` and the TypeDoc build. A failure in any step stops the workflow, and deploy, package-check and publish then do not run.
2. **server-install** runs `npm ci --omit=dev --no-audit --no-fund` from the repository lockfile, the install the server runs after a deploy, in `node:22-bookworm-slim`: Node 22, as production runs it, with no make, compiler or Python. npm builds a package from its lockfile entry, which can need a toolchain where a fresh install takes a prebuilt binary, as better-sqlite3 13.0.3 did.
3. **compiled-server** checks out the commit on a separate runner, runs `npm ci --ignore-scripts --no-audit --no-fund` and invokes TypeScript directly. Its artifact supplies the hosted server's `dist/` files; the dashboard and docs build supplies only `dist/dashboard/`, `src/dashboard/dist/` and `docs/api/`.
4. **deploy** waits for build, server-install and compiled-server. It checks out `github.sha` without stored credentials and takes source, scripts, assets, scenarios, configuration and both root manifests from that commit, adding only the built outputs from the artifacts. It stamps `package.json` with the version selected by build, which package-check also uses: the run-number release for a publishing push, otherwise the current npm version (the run-number version if npm is unavailable). The compiled server reads this package version for `/health`. The copy keeps host state and makes deployed code root-owned. The remote script installs with `npm ci --omit=dev --no-audit --no-fund`, retries that exact command once after 15 seconds, and stops before restarting if both attempts fail. It starts `dist/cli/serve.js` with pm2's `--uid paracosm --gid paracosm` and `--max-memory-restart 1200M`, retaining the client-IP header and allowed-origin settings. Account, state-layout and ownership preparation runs before the old process stops. The deploy sets `PARACOSM_SCENARIO_STORE_DIR` to `APP_DIR/data/scenarios` for administrator disk saves; boot loads these alongside bundled scenarios, which stay root-owned. When an administrator saves a scenario to disk with a bundled scenario’s ID, the saved version takes precedence across deploys.
5. **package-check** runs when the push publishes (a shipped file changed since the last release tag, as `scripts/library-changed-since-release.sh` decides for publish too). It builds the package and the dashboard, takes the release version selected by build (the major and minor of `package.json` with the workflow run number as the patch), packs the tarball that publish ships, and hashes and uploads it before anything installs it. It then checks those bytes with `scripts/smoke-packed-package.mjs`, which installs the tarball into an empty project, starts `paracosm-dashboard` and requests its pages and their assets, and runs the same check again in `node:22-bookworm-slim` after reinstalling the project from the lockfile its install wrote with `npm ci`, as a user who commits a lockfile installs it on a machine with no toolchain. Building runs dependency code, and in that project npm resolves every dependency afresh and runs their install scripts, so the job has a read-only token, no stored git credentials and no secrets.
6. **publish** runs only while the pushed commit is still master's head, and compares it with the commit of the last release tag (`v<version>`; a tag with a pre-release suffix such as `v1.0.0-rc.1` is not a release), so the changes of a run that a later push replaced are not lost. With no release tag in the commit's history, it publishes. It publishes only when those commits change a file the npm package ships or builds from: source under `src/` (test files excluded), the dashboard included because the package ships its build in `dist/dashboard/`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `scripts/pack-dashboard.mjs`, or a path the `files` field of `package.json` lists beside `dist/` and the README (scenarios, the actor configuration, the landing page's assets, `LICENSE`). [`scripts/detect-library-change.mjs`](https://github.com/framerslab/paracosm/blob/master/scripts/detect-library-change.mjs) holds the rule. It waits for package-check, then downloads the tarball, checks it against the SHA-256 and the version package-check recorded, generates the release notes, runs `npm publish` on that tarball with scripts off and creates the GitHub release `v<version>`. It installs nothing and builds nothing, so no dependency code runs beside its tokens: the write token (`contents` and `actions`), which checkout does not store and which only the steps that call GitHub receive; the npm token; and the OIDC token (`id-token: write`) that npm trusted publishing exchanges for a publish token, which needs npm 11.5.1 or later, as Node 24 ships. When it finds a shipped change that package-check did not see (a release tag made or deleted between the two jobs, or the job re-run alone), there is no checked tarball, and it fails: re-run the whole workflow. A push that changes none of those paths since the last release, such as a documentation or test change, publishes nothing. A deploy run in progress finishes before the next one starts. When `master` has moved to a commit with no deploy run of its own (a `[skip ci]` commit), publish dispatches one on `master`, which publishes in its place. A change under `src/dashboard/` that leaves the build output the same, such as a type-only devDependency bump, still publishes a version whose files match the previous one apart from the version. A root devDependency bump publishes as well, and its `package.json`, which ships with its devDependencies, differs. Only this job creates `v*` tags: a release tag made by hand becomes the comparison baseline and can hide changes that were never published.

The remote script creates the `paracosm` system user and group idempotently. The application directory, source and dependencies remain owned by root; the service user owns only `data/`, `output/`, `.live-runs/`, `.paracosm/`, `scenarios/compiled/` and the runtime JSON files. Existing rate-limit state and the legacy `.event-buffer.json` move under `.paracosm/`, with their application-directory paths linked there. Atomic saves and legacy-buffer cleanup operate on the writable targets without changing the application directory. `.env` remains owned by `root:paracosm` with mode `640`: the service group can read the keys, other users cannot, and only root can edit them. The pm2 daemon and its startup unit remain root-owned.

Configure the repository secrets `SERVER_IP`, `APP_DIR`, `DEPLOY_SSH_KEY` and `SERVER_HOST_KEY` for deploy. `APP_DIR` must be an absolute directory below `/` with no `.` or `..` components. `SERVER_HOST_KEY` holds exactly `ssh-ed25519 <key>` (the first two fields of `/etc/ssh/ssh_host_ed25519_key.pub`), read through the Linode Lish console. Setup writes it as the only known-host entry and enables `StrictHostKeyChecking yes`; an empty or different key stops the deploy. When the box is rebuilt, read its new key through that console and update `SERVER_HOST_KEY` before the next deploy. Until the stored key matches, connections fail closed.

The deploy workflow never writes to `master`. A failed publish leaves `master` as it was and no GitHub release for that version. After fixing the cause, re-run the failed publish job to publish the version the site already names. A later publishing push uses its own run number.

Each release's changes are in the notes of its [GitHub release](https://github.com/framerslab/paracosm/releases). `CHANGELOG.md` groups them by major and minor version and does not ship in the npm package. It gains an entry after a merge that changes the major or minor version in `package.json`: a pull request holds the output of `npm run changelog` on `master`.

Never edit `CHANGELOG.md` or the version in `package.json` to release, and never run `npm publish` by hand.

To deprecate a published version, such as one whose install fails, run the [Deprecate a version](https://github.com/framerslab/paracosm/blob/master/.github/workflows/deprecate.yml) workflow by hand with the version and a message that says why and which version to use instead; an empty message clears the mark. A published version is never unpublished, so every lockfile that names it stays installable.

## Code of Conduct

By participating you agree to follow the [Code of Conduct](https://github.com/framerslab/paracosm/blob/master/.github/CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately as the [security policy](https://github.com/framerslab/paracosm/blob/master/.github/SECURITY.md) describes, never in a public issue.

## Maintainers

Reviews are routed through [.github/CODEOWNERS](https://github.com/framerslab/paracosm/blob/master/.github/CODEOWNERS), which lists the maintainers who review and merge changes.

## Contact

Questions about using paracosm go to [Discord](https://wilds.ai/discord). Commercial, partnership or sponsorship inquiries: team@frame.dev or [frame.dev](https://frame.dev).
