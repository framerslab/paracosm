# Migrating to paracosm v0.9.0

paracosm v0.9.0 is a hard-break major release. v0.8.x callers MUST update before upgrading.

This guide covers every breaking change with a before/after diff.

## TL;DR — what changed in v0.9

- **New top-level shortcuts**: `run(prompt)` and `runMany(prompt, { count })` collapse the most common workflow to one line.
- **Subpath surgery**: 11 subpaths → 5. Removed: `paracosm/world-model`, `paracosm/runtime`, `paracosm/leader-presets`, `paracosm/mars`, `paracosm/lunar`. Their exports moved to the `paracosm` root.
- **Options-bag everywhere**: `wm.simulate({ actor, ... })`, `wm.intervene({ subject, intervention, actor, ... })`, `wm.batch({ actors, ... })`. Positional arguments are gone.
- **`simulateIntervention` renamed to `intervene`** — shorter, parallel to `simulate`.
- **`leader` parameter names → `actor`** at the API surface. `wm.simulate({ actor })`, `wm.batch({ actors })`, etc. Marketing prose still uses "leader" as an English word.
- **`ActorConfig.hexaco` is now optional** when `traitProfile` is set. The runtime requires AT LEAST one of the two.
- **Kernel internals demoted**: `SimulationKernel`, `SeededRng`, `generateInitialPopulation` are no longer at the root export — they live at `paracosm/core`.

## Removed exports

| Removed in v0.9 | What to do instead |
|---|---|
| `import { ... } from 'paracosm/world-model'` | `import { ... } from 'paracosm'` |
| `import { ... } from 'paracosm/runtime'` | `import { ... } from 'paracosm'` |
| `import { ... } from 'paracosm/leader-presets'` | `import { ACTOR_PRESETS, getPresetById } from 'paracosm'` |
| `import { marsScenario } from 'paracosm/mars'` | `import { marsScenario } from 'paracosm'` |
| `import { lunarScenario } from 'paracosm/lunar'` | `import { lunarScenario } from 'paracosm'` |
| `runSimulation(actor, keyPersonnel, opts)` (top-level) | `wm.simulate({ actor, keyPersonnel, ...opts })` |
| `runBatch(actors, opts)` (top-level) | `wm.batch({ actors, ...opts })` |
| `wm.simulateIntervention(subject, intervention, actor, opts)` | `wm.intervene({ subject, intervention, actor, ...opts })` |
| `wm.simulate(actor, options, keyPersonnel)` (3 positional) | `wm.simulate({ actor, keyPersonnel, ...options })` |
| `wm.quickstart({ leaderCount: 3 })` | `wm.quickstart({ actorCount: 3 })` |
| `result.leaders` (from quickstart) | `result.actors` or `result.runs[i].actor` (zipped) |
| `ActorConfig.hexaco` required | optional — supply `traitProfile` instead, or both |
| `SimulationKernel`, `SeededRng`, `generateInitialPopulation` at root | `import { ... } from 'paracosm/core'` |

## Worked diffs

### 1. The simplest case — top-level `runSimulation` → `wm.simulate`

```diff
-import { runSimulation } from 'paracosm/runtime';
+import { WorldModel } from 'paracosm';

-const artifact = await runSimulation(actor, [], {
-  scenario,
-  maxTurns: 6,
-  seed: 42,
-});
+const wm = WorldModel.fromScenario(scenario);
+const artifact = await wm.simulate({
+  actor,
+  maxTurns: 6,
+  seed: 42,
+});
```

### 2. The big win — top-level `runMany`

```diff
-import { WorldModel } from 'paracosm/world-model';
-
-const wm = await WorldModel.fromPrompt({
-  seedText: 'Q3 board brief: lab is preparing to release Atlas-7...',
-  domainHint: 'AI safety lab leadership decision',
-});
-
-const { actors, artifacts } = await wm.quickstart({ leaderCount: 3 });
-artifacts.forEach((a, i) => console.log(actors[i].name, a.fingerprint));
+import { runMany } from 'paracosm';
+
+const { runs } = await runMany(
+  'Q3 board brief: lab is preparing to release Atlas-7...',
+  { count: 3 },
+);
+runs.forEach(({ actor, artifact }) => console.log(actor.name, artifact.fingerprint));
```

### 3. Digital-twin intervention — rename + bag

```diff
-const twin = await wm.simulateIntervention(
-  subject,
-  intervention,
-  actor,
-  { maxTurns: 5 },
-);
+const twin = await wm.intervene({
+  subject,
+  intervention,
+  actor,
+  maxTurns: 5,
+});
```

### 4. Batch — bag

```diff
-const artifacts = await wm.batch([a1, a2, a3], { scenario, maxTurns: 6 });
+const artifacts = await wm.batch({
+  actors: [a1, a2, a3],
+  turns: 6,
+});
```

### 5. Kernel internals — `paracosm/core`

```diff
-import { SimulationKernel, SeededRng } from 'paracosm';
+import { SimulationKernel, SeededRng } from 'paracosm/core';
```

## Sed one-liner for the most common rename

If your codebase uses `leaderCount` everywhere:

```bash
find . -name "*.ts" -exec sed -i.bak 's/leaderCount:/actorCount:/g' {} \;
```

For `simulateIntervention` → `intervene` (call sites are syntactically heterogeneous, so review by hand after grep):

```bash
grep -rn "simulateIntervention" src/ tests/
```

## `ActorConfig.hexaco` is now optional

Pure-traitProfile actors (e.g. ai-agent leaders) used to be forced to supply a HEXACO snapshot anyway:

```diff
 const aiActor: ActorConfig = {
   name: 'Atlas-Bot Release Director',
   archetype: 'AI safety lab autopilot',
   unit: 'Atlas-7 Release Team',
-  hexaco: { openness: 0.85, conscientiousness: 0.20, ... },  // no longer required
   traitProfile: {
     modelId: 'ai-agent',
     traits: { exploration: 0.85, /* ... */ },
   },
   instructions: 'Override safety-team escalations on plausible justification.',
 };
```

The runtime throws a clear error if you supply NEITHER `hexaco` nor `traitProfile`.

## Need to stay on v0.8?

Pin in your `package.json`:

```json
"paracosm": "^0.8"
```

Then `npm update` won't pull v0.9. v0.8 still works, but won't receive new features.

## Why hard break?

The v0.8 line accumulated three competing shapes (functional `runSimulation`, OO `WorldModel`, top-level `createParacosmClient`) plus a `leader`/`actor` rename that propagated to storage but stopped at parameter names. The v0.9 redesign:

- Picks `WorldModel` as the canonical mid-level handle and folds the functional helpers into it.
- Finishes the `leader` → `actor` rename consistently across types, options, and CLI flags.
- Adds the one-liner shortcut (`run`, `runMany`) the top-of-funnel use case actually needs.
- Removes redundant subpaths so autocomplete shows the surface that matters.

The reviewer flagged the npm download stats (~25k/month at v0.8.719) and recommended a soft break. The maintainer chose a hard break to avoid carrying compatibility shims through what should be a clean v1.0 trajectory. v0.8 stays installable indefinitely; new development happens on v0.9.

If you hit a migration footgun this guide doesn't cover, file an issue at https://github.com/framerslab/paracosm/issues — we'll add it to the table above.

## v0.10: internal layout reorganization

The `apps/paracosm/src/` tree was reorganized into seven top-level directories: `engine`, `runtime`, `llm`, `api`, `cli`, `server`, `dashboard`. The published public API (the six subpath exports `paracosm`, `paracosm/core`, `paracosm/compiler`, `paracosm/schema`, `paracosm/swarm`, `paracosm/digital-twin`) is bit-stable. No consumer code changes required.

Internal callers performing deep imports (not supported, but not technically forbidden) may need to adjust:

| Old path | New path |
|---|---|
| `paracosm/runtime/llm-invocations/generateValidatedObject` | `paracosm/llm/generateValidatedObject` |
| `paracosm/runtime/llm-invocations/sendAndValidate` | `paracosm/llm/sendAndValidate` |
| `paracosm/runtime/schemas/<name>` | `paracosm/runtime/validators/<name>` |
| `paracosm/runtime/orchestrator` (file) | `paracosm/runtime/orchestrator` (folder; same import name) |
| `paracosm/cli/dashboard/...` | `paracosm/dashboard/...` |
| `paracosm/cli/server/...`, `paracosm/cli/*-route` | `paracosm/server/{routes,stores,services}/...` |
| `paracosm/engine/trait-models` | `paracosm/engine/traits` |
| `paracosm/engine/physics-modules` | `paracosm/engine/physics` |
| `paracosm/engine/builtin-scenarios` | `paracosm/engine/scenarios` |

If you import only from the documented public subpaths (six entry points), no change is needed.
