# Paracosm Tests

The test suite for the Paracosm engine, runtime, compiler, and CLI.

## Layout

The directory structure mirrors `src/`:

```
tests/
  cli/                  CLI option parsers, server endpoints, sim config
  engine/
    compiler/           Scenario compiler hook generation + integration
      helpers/          The real seed compile, and a run of what it compiles,
                        on a stub model (no network, no paid call)
    core/               Deterministic kernel, RNG, progression, golden runs
    lunar/              Lunar Outpost scenario integration
    mars/               Mars Genesis scenario hooks (politics, milestones,
                        names, prompts, reactions, fingerprint, etc.)
    *.test.ts           Engine surface: types, registries, taxonomy
  runtime/              Orchestrator helpers, agent memory, batch runner
    helpers/            A stand-in for the OpenAI API at the wire, and a
                        Mars Genesis run through the turn loop on it
    research/           Scenario research bundle lookup; each run's own research memory
  fixtures/             Recorded runs, replies and scenarios the tests read
    compiler/           Drafts, an extraction and a saved compiled scenario for
                        the seed compile; its README says which are recordings
```

Dashboard component tests stay colocated under
[src/cli/dashboard/src/](../src/cli/dashboard/src/) because they ship with
the React tree and are built/tested by the dashboard sub-project.

## Running

```bash
npm test                                  # full suite (engine + dashboard)
node --import tsx --test tests/engine/    # just engine tests
node --import tsx --test tests/runtime/   # just runtime tests
```

The runner is Node's built-in `node:test`, no Jest/Vitest required.

## Conventions

- One `*.test.ts` per `*.ts` module under test.
- Pure unit tests where possible; integration tests live next to the
  feature they integrate (e.g., `tests/engine/compiler/integration.test.ts`).
- Live LLM tests are gated behind env flags (`RUN_LIVE_CHAT_TEST=1`) so
  the offline suite stays green without API keys.
- Tests are excluded from the published npm package via
  `tsconfig.build.json`.

## Why a separate `tests/` directory?

Until 2026-04, tests were colocated with source files
(`src/runtime/foo.ts` + `src/runtime/foo.test.ts`). Both layouts are
valid; the move to a top-level `tests/` directory was a legibility
choice — visitors can see at a glance that the project has tests, and
the test suite reads as one cohesive unit instead of being scattered
across the source tree.
