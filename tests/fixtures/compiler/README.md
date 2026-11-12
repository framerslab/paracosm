# Compiler fixtures

What the stub model of `tests/engine/compiler/helpers/stub-model-compile.ts` answers the seed compile with, and a compiled scenario as the server saves one. Four files are recordings of what a model drafted; the other three are written by hand.

## Recordings

Each is a byte for byte copy of a file the cookbook runners captured (`docs/COOKBOOK.md`): the draft fields (`id`, `labels`, `setup`, `departments`, `metrics`, `theme`) of a scenario `WorldModel.fromPrompt` compiled from a model's draft, as each runner's `summarizeScenario` saved them. A test hands each one to the compile as the model's reply to the draft call.

| Fixture | Copied from | Captured |
|---|---|---|
| `recorded-draft-ai-lab.json` | `output/cookbook/01-output-scenario-package.json` | 25 April 2026, `scripts/cookbook-e2e.ts`, draft model `gpt-5.4-mini` |
| `recorded-draft-generation-ship.json` | `output/cookbook/creative/generation-ship-output.json` | 26 April 2026, `scripts/cookbook-creative.ts`, draft model `gpt-5.4-mini` |
| `recorded-draft-pandemic-governor.json` | `output/cookbook/creative/pandemic-governor-output.json` | 26 April 2026, `scripts/cookbook-creative.ts`, draft model `gpt-5.4-mini` |
| `recorded-draft-game-studio.json` | `output/cookbook/creative/game-studio-director-output.json` | 26 April 2026, `scripts/cookbook-creative.ts`, draft model `gpt-5.4-mini` |

`git ls-tree HEAD <path>` gives each fixture the blob id of the file it was copied from.

## Written by hand

| Fixture | What it is |
|---|---|
| `draft-orchard-bare.json` | The `orchard-seasons` draft of `tests/engine/progression-time-scale.test.ts`: two departments, two metrics, a season of a quarter of a year. |
| `extraction-orchard.json` | A reply to the seed extraction, in the shape its prompt asks for (`src/engine/compiler/seed-ingestion.ts`): three topics with a fact or more each, no search query, and two crisis categories in plain words. Neither category names a topic or appears in a fact, so each maps to the first two topics. No reply to the extraction was ever recorded. |
| `persisted/compiled/orchard-seasons.json` | A compiled scenario in the folder layout the server reads at boot (`src/cli/persisted-compiled-scenarios.ts`): the bare orchard draft compiled with no seed text and saved with no seed text. `tests/engine/compiler/compiled-before-world.test.ts` shows it is what the compiler and the server's writer produce for that draft, but for `_persistMeta.compiledAt`. |
