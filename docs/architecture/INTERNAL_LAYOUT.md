# Paracosm Internal Layout

This document describes the contributor-facing layout of `apps/paracosm/src/`. For the consumer-facing public API, see the `paracosm` package's `exports` map and the user-facing docs (`README.md`, `docs/COOKBOOK.md`, `docs/HTTP_API.md`).

## The seven top-level directories

```
src/
├── engine/      Scenario kernel + compile-time
├── runtime/     Per-turn simulation execution
├── llm/         Shared LLM primitives
├── api/         Public run/runMany surface
├── cli/         CLI entry points and scenario-config helpers
├── server/      HTTP server
└── dashboard/   Vite/React UI
```

Each directory owns one job. New top-level directories require justification (a one-line entry in this document).

### `engine/`

Scenario definition + compile-time + deterministic kernel. The compiler runs ONCE per scenario (output cached); the kernel runs MANY times during a simulation. Subfolders:

- `core/` — deterministic state machine (state, kernel, RNG, snapshot, progression, agent-generator)
- `compiler/` — LLM-driven scenario compilation (runs once at compile time)
- `schema/` — foundational types and Zod validators
- `scenarios/` — built-in scenario loaders (mars, lunar, etc.)
- `physics/` — physics modules registry (radiation, supplies, regolith, etc.)
- `traits/` — HEXACO + AI-agent trait registries
- `presets/` — actor presets
- `provider/` — provider key resolution + credentials
- `digital-twin/` — public-API alias barrel for `WorldModel as DigitalTwin`
- `data-driven-hooks/` — hook factory
- `registries/` — effects, events, metrics

### `runtime/`

Per-turn simulation execution. LLM-driven, async, stateful. Subfolders:

- `orchestrator/` — turn loop (orchestrator, director, departments, commander-setup, reaction-step, emergent-setup, tool-ledger)
- `agents/` — chat-agents, agent-memory, agent-reactions, plus `cues/{hexaco,trait}/` translation helpers
- `world-model/` — `WorldModel` façade (replay, fork, snapshot, simulate, intervene, batch)
- `swarm/` — pure projection functions over `RunArtifact` swarm view
- `research/` — citation/research memory
- `validators/` — Zod validators for LLM responses (commander, department, director, reactions, verdict)
- `economics/` — cost-tracker, pricing, economics-profile
- `io/` — output-writer, build-artifact, sse-envelope, citations-catalog, canonical-json, world-snapshot
- `util/` — parsers, runtime-helpers, provider-errors, generic-fingerprint

Top-level files: `client.ts` (createParacosmClient), `batch.ts`, `contracts.ts`, `index.ts`.

### `llm/`

Shared LLM primitives over `@framers/agentos`. Files:

- `generateValidatedObject.ts` — one-shot validated LLM call (cost tracking, fallback chain, provider error classification)
- `sendAndValidate.ts` — session-aware validated LLM call (preserves conversation memory; retry-with-feedback)

Both are imported by `runtime/` and `engine/compiler/`. The dual-consumer pattern is the reason `llm/` is a top-level dir rather than nested under runtime/.

### `api/`

The public `run`, `runMany`, `WorldModel` surface. Four files: `run.ts`, `run.test.ts`, `types.ts`, `types.test.ts`. Re-exported by `src/index.ts`.

### `cli/`

The `bin/paracosm` command. Entry points (run, run-a, run-b, compile, init, serve, help, pair-runner, fetch-seed-url) and scenario-config helpers (sim-config, actors-resolver, custom-scenarios, compile-cli-options, cli-run-options, persisted-compiled-scenarios). About 20 files; all share the single job of "be the CLI."

### `server/`

The HTTP server backing the `bin/paracosm-dashboard` command. Subfolders:

- `routes/` — HTTP route handlers (simulate, bundle, quickstart, library-import, waitlist, unsubscribe, platform-api, public-demo)
- `stores/` — run-history, sqlite-run-history, session, waitlist, mail-suppression
- `services/` — deep-research, email, email-templates, optional-mail, bundle-id, enrich-run-record, run-record, run-summary-trajectory

Top-level files: `server-app.ts`, `router.ts`, `server-mode.ts`, `rate-limiter.ts`, `retry-stats.ts`, `session-title.ts`, `fork-preconditions.ts`.

### `dashboard/`

The Vite/React UI. Self-contained: own `package.json`, own `vite.config.ts`, own `tsconfig.json`. Communicates with `server/` via `fetch()` only — no direct imports from `server/`. Type-imports from `engine/schema/`. Excluded from the library `tsconfig.build.json`.

## The boundary rule

`engine/` does not import `runtime/`. One exemption: `src/engine/digital-twin/index.ts`, the public-API alias barrel for `WorldModel as DigitalTwin`. Enforced by `scripts/check-engine-runtime-boundary.mjs` (runs as part of `npm test`).

When you need a helper used by both engine and runtime, place it in `src/llm/` if it's an LLM primitive, or in `src/api/` if it's a top-level facade. Do not introduce a new engine→runtime import.

## Naming conventions

- Folder names: kebab-case (`agent-memory`, `digital-twin`, `world-model`, `data-driven-hooks`)
- File names: kebab-case (`build-artifact.ts`, `generate-prompts.ts`, `tool-ledger.ts`)
- Class names: PascalCase (`WorldModel`, `EventDirector`, `AgentMemory`)
- Function names: camelCase (`runSimulation`, `generateValidatedObject`)
- snake_case is not used anywhere

## Where new code goes

A short decision tree for placing new files:

1. Does it call LLMs every turn during a simulation? → `runtime/`. Pick the subfolder by domain (orchestrator, agents, economics, io, util)
2. Does it call LLMs once at scenario-compile time? → `engine/compiler/`
3. Is it a primitive over an `@framers/agentos` call? → `src/llm/`
4. Is it a foundational type or Zod schema? → `engine/schema/`
5. Is it a Zod validator for an LLM response? → `runtime/validators/`
6. Is it a deterministic helper (no LLM, no I/O)? → `engine/core/` if kernel-level, otherwise `runtime/util/`
7. Is it an HTTP route handler or server-side state? → `server/`
8. Is it a CLI entry point or scenario-config helper? → `cli/`
9. Is it dashboard UI code? → `dashboard/`
10. None of the above → ask in PR review whether the layout needs a new dir or a new subfolder

## Public-export-to-internal-path mapping

| Public export | Internal path |
|---|---|
| `paracosm` (root) | `dist/index.js` |
| `paracosm/core` | `dist/engine/core/state.js` |
| `paracosm/compiler` | `dist/engine/compiler/index.js` |
| `paracosm/schema` | `dist/engine/schema/index.js` |
| `paracosm/swarm` | `dist/runtime/swarm/index.js` |
| `paracosm/digital-twin` | `dist/engine/digital-twin/index.js` |

Six entry points. No wildcard fallback. External consumers do not deep-import; the internal paths above are implementation details that may change in any release.

## Tests

Tests live alongside implementation: `foo.ts` next to `foo.test.ts`. The `tests/` directory at the repo root contains higher-level tests (smoke, fixtures, integration) that span multiple `src/` modules. The `tests-e2e/` directory contains Playwright e2e tests against the dashboard.

The npm test script runs:
- The engine→runtime boundary check (`scripts/check-engine-runtime-boundary.mjs`)
- Dashboard typecheck (`tsc -p src/dashboard`)
- All test files under `tests/`, `src/api/`, `src/cli/`, `src/engine/`, `src/runtime/`, `src/llm/`, `src/server/`, `src/dashboard/src/`
