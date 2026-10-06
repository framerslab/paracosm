# Paracosm Architecture

Paracosm is an **agent swarm simulation framework for structured world modeling with LLMs**. It compiles prompts, documents, URLs, or scenario JSON drafts into a typed `ScenarioPackage`, then runs multi-agent simulations: one or more AI leaders with HEXACO personality profiles direct a swarm of specialist departments and ~100 personality-typed agents through a deterministic kernel, producing measurably different outcomes from identical starting conditions. Fits the structured / LLM-based / top-down-swarm branch of the 2026 world-model taxonomy; see [`docs/positioning/world-model-mapping.md`](positioning/world-model-mapping.md) for the placement against adjacent categories.

This document covers the full system: how scenarios become simulations, how the agent swarm runs (leader → specialists → cells), how tools get forged at runtime, how the swarm exposes itself to consumers via the public API, how the chat system maintains character consistency, and how the universal schema enables arbitrary scenario types.

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   World Source Material                       │
│  Prompt / brief / URL / scenario JSON draft                  │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                      Scenario Compiler                       │
│  Validated ScenarioPackage + LLM-generated runtime hooks      │
│  Cost: ~$0.10. Cached to disk after first compile.           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Deterministic Kernel                       │
│  RNG (seeded), state machine, metric updates, progression    │
│  Same seed + same decisions = same numerical outcomes         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                     Runtime Orchestrator                      │
│  Turn pipeline: Director → Kernel → Departments → Commander  │
│  All leaders run in parallel (pair via Promise.all, cohort   │
│  via bounded worker pool sized to economics.maxConcurrency)  │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│                       Agent Swarm                            │
│  1 leader → 5 specialist departments → ~100 cells           │
│  Per-agent: HEXACO traits, mood, family edges, memory       │
│  Surfaced on RunArtifact.finalSwarm + paracosm/swarm        │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Dashboard (React/Vite) + SSE Stream             │
│  Side-by-side visualization, reports, chat, event log        │
│  Living-swarm grid renders the cell population per turn     │
└─────────────────────────────────────────────────────────────┘
```

## The Engine

### Scenario Definition

A scenario JSON file is the runtime contract that describes the simulation domain. It does not contain any code. Prompt text, briefs, and URLs can ground the contract through the compiler, but the kernel only runs the validated `ScenarioPackage`. The engine handles crisis generation, state transitions, tool forging, and personality drift. The scenario handles domain vocabulary and structure.

```json
{
  "id": "mars-genesis",
  "labels": { "name": "Mars Genesis", "populationNoun": "colonists", "settlementNoun": "colony" },
  "setup": { "defaultTurns": 6, "defaultSeed": 950, "defaultStartTime": 2035, "defaultTimePerTurn": 8 },
  "departments": [
    { "id": "medical", "label": "Medical", "role": "Chief Medical Officer", "instructions": "Analyze health impacts..." },
    { "id": "engineering", "label": "Engineering", "role": "Chief Engineer", "instructions": "Analyze infrastructure..." }
  ],
  "metrics": [
    { "id": "population", "format": "number" },
    { "id": "morale", "format": "percent" }
  ]
}
```

**Any domain works.** Mars colonies, submarine habitats, space stations, medieval kingdoms. The engine is domain-agnostic. The compiled scenario contract defines what gets simulated.

**Terminology.** The `labels.populationNoun` (plural, e.g. `colonists` → `crew` → `subjects`) and `labels.settlementNoun` (singular, e.g. `colony` → `habitat` → `kingdom`) fields flavour every user-facing string in the dashboard: help legends, roster headers, empty states, ARIA labels, report copy. The engine defaults to `colonists` / `colony` when omitted (Mars heritage), but non-Mars scenarios should override both. Singular/capitalized variants are derived automatically by the dashboard's `useScenarioLabels()` hook.

### Seed Enrichment & Citation Flow

The compiler accepts real-world source material (`--seed-text` or `--seed-url`) and threads citations end-to-end through the simulation:

```
SEED                            (text or URL: Firecrawl extracts markdown)
  ↓
EXTRACT                         (LLM → topics, facts, searchQueries, crisisCategories)
  ↓
SEARCH                          (AgentOS WebSearchService: Firecrawl + Tavily +
                                  Serper + Brave in parallel, semantic dedup,
                                  RRF fusion, optional Cohere rerank-v3.5)
  ↓
KNOWLEDGE BUNDLE                (topics[].canonicalFacts[], categoryMapping)
  ↓ runtime init
RESEARCH MEMORY                 (AgentOS AgentMemory.sqlite: semantic recall)
  ↓ per event
recallResearch(query, keywords) (semantic memory recall, fall back to bundle,
                                  fall back to live web search if liveSearch=on)
  ↓
DEPARTMENT PROMPT               (citations injected as `[claim](url)` markdown)
  ↓
DEPARTMENT REPORT               (LLM returns citations[]; orchestrator auto-fills
                                  from packet if LLM omits them: provenance
                                  guarantee)
  ↓
SSE specialist_done event       (citationList[]: text, url, doi)
  ↓
DASHBOARD REPORTS TAB           (clickable citation links beneath each summary)
```

The Event Director also receives the knowledge bundle's `topics` and `categories`. Its `researchKeywords` and `category` fields stay grounded in actual citation entries, so retrieval downstream finds matches.

### Scenario Compiler

The compiler turns a scenario JSON draft plus optional prompt/document/URL grounding into a runnable `ScenarioPackage` by generating TypeScript hook functions via LLM calls:

| Hook | What it generates | Called when |
|------|-------------------|------------|
| `progressionHook` | Between-turn state updates (radiation, bone density, etc.) | Between every turn |
| `departmentPromptHook` | Department-specific analysis context | Before each department analyzes |
| `fingerprintHook` | Timeline classification from final state | After simulation completes |
| `politicsHook` | Political/social effects for relevant events | After political/social crises |
| `getMilestoneEvent` | Fixed narrative events (Turn 1 founding, final assessment) | Turn 1 and final turn |
| `reactionsHook` | Colonist personality-aware reactions | After each commander decision |

Compilation costs ~$0.10 and is cached to disk. The compiler accepts `--seed-text` and `--seed-url` for domain research, and `--no-web-search` to skip web enrichment. A future prompt-only wrapper should first generate this same JSON contract, then validate and compile it.

### Deterministic Kernel

The `SimulationKernel` manages all numerical state. It is deterministic: given the same seed and the same commander decisions, it produces identical outcomes.

The kernel tracks:
- **Colony metrics**: population, morale, food reserves, power, infrastructure modules, science output
- **Agent population**: each colonist has health (alive, psychScore, conditions), career (role, rank, specialization), social (partner, children, friends), and narrative (featured, quotes) data
- **Progression**: between-turn updates (aging, mortality, births, career advancement, personality drift)

The kernel uses a `SeededRng` (deterministic PRNG) for all random decisions: colonist generation, mortality probability, birth events, personality drift magnitudes. Two simulations with the same seed produce the same colonist names, the same birth/death events, and the same base progression.

What differs is each commander's decisions. The crisis is the same, the department analysis is the same, but commanders with different HEXACO profiles choose differently. The kernel applies different numerical effects based on the choice, and divergence compounds across the cohort.

### Health Fields

Core agent health fields (`AgentHealth`):
- `alive`, `psychScore`, `conditions` are universal (every scenario)
- `boneDensityPct`, `cumulativeRadiationMsv` are optional (Mars/Lunar specific)
- `[key: string]: unknown` index signature allows any scenario to add custom health fields

Custom scenarios define their own health metrics in their progression hooks. The kernel doesn't hard-code any domain-specific health logic.

## The Runtime

### Turn Pipeline

Each turn follows a fixed pipeline:

```
1. Event Director generates a crisis from current colony state
   └── LLM reads: colony metrics, recent events, population health, tool history
   └── Produces: title, description, options (safe/risky), category, research keywords

2. Kernel applies between-turn progression
   └── Aging, mortality, births, career advancement
   └── Scenario-specific hooks (radiation, bone density for Mars)

3. Department agents analyze the crisis IN PARALLEL
   └── Each department gets: crisis context, colony snapshot, research citations, memory
   └── Each department produces: summary, risks, recommended actions, forged tools
   └── All 5 departments run concurrently via Promise.all (~30s total vs ~150s sequential)

4. Commander reads department reports and decides
   └── LLM reads: crisis, all department summaries, HEXACO personality profile
   └── Produces: decision text, rationale, selected policies, risky/safe choice

5. Kernel applies decision effects
   └── Outcome determined by crisis probability + commander choice
   └── Bounded numerical effects applied to colony metrics

6. Colonist reactions generated
   └── Featured colonists react based on their personality and the decision
   └── Reactions are mood-tagged and personality-aware

7. State broadcast via SSE
   └── All events streamed to dashboard in real time
```

### LLM Reliability

Every structured LLM call in paracosm routes through one of two schema-validated wrappers:

- **[`generateValidatedObject`](../src/llm/generateValidatedObject.ts)**: one-shot calls over AgentOS `generateObject`. Used for director event batches, reaction batches, verdict.
- **[`sendAndValidate`](../src/llm/sendAndValidate.ts)**: session-aware wrapper over AgentOS `session.send()`. Preserves conversation memory (commander remembers prior events, dept heads remember prior analyses) while adding Zod retry-with-feedback. Used for commander decisions, department reports, and promotions.

Both wrappers return the fully-validated object matching a Zod schema in [`src/runtime/validators/`](../src/runtime/validators/). Validation failures trigger up to 2 retries with the Zod error appended to the retry prompt so the model self-corrects. If retries exhaust, the wrapper returns a caller-provided fallback skeleton and emits a `validation_fallback` SSE event so the dashboard can surface the degradation.

| Call site | Schema | Wrapper |
|-----------|--------|---------|
| Director event batch | `DirectorEventBatchSchema` | `generateValidatedObject` |
| Department report | `DepartmentReportSchema` | `sendAndValidate` |
| Commander decision | `CommanderDecisionSchema` | `sendAndValidate` |
| Promotions | `PromotionsSchema` | `sendAndValidate` |
| Reactions batch | `ReactionBatchSchema` | `generateValidatedObject` |
| Verdict | `VerdictSchema` | `generateValidatedObject` |

The commander, verdict, and director all write their stepwise reasoning into a `reasoning` field on their schema. The field is preserved in the run artifact (previously reasoning lived in stripped-and-discarded `<thinking>` tags). Dashboard renders the compressed `rationale` by default and the full `reasoning` behind a "show full analysis" expand.

### Emergent Tool Forging

Department agents forge computational tools at runtime using AgentOS's `EmergentCapabilityEngine`. When a department encounters a crisis it cannot analyze with existing tools, it writes JavaScript code to build a custom calculator.

**How it works:**

1. The department agent calls `forge_tool` with a name, description, input/output schema, implementation code, and test cases.
2. A pre-judge validator (`validateForgeShape`) checks the request is well-formed. When the LLM emits concrete test cases but forgets to declare `inputSchema.properties` / `outputSchema.properties`, a companion helper `inferSchemaFromTestCases` synthesizes the missing properties from the test data so the forge doesn't get rejected on a formality the test cases already witnessed.
3. The `SandboxedToolForge` delegates to AgentOS's hardened `CodeSandbox` node:vm context with these guarantees:
   - **Wall-clock timeout** enforced via `vm.runInContext` (default 10 seconds; configurable via `sandboxTimeoutMs`).
   - **Memory observed** via `process.memoryUsage().heapUsed` delta after each invocation. The default `sandboxMemoryMB: 128` is a soft monitoring target, not a hard cap; the sandbox does not preempt on overrun.
   - **`codeGeneration: { strings: false, wasm: false }`** at context construction blocks runtime `eval` and `Function()` reflection.
   - **Frozen `console`** plus explicit-undefined for `process`, `globalThis`, `require`, `setTimeout`, `setInterval`, `fetch`.
   - **Realm intrinsics blocked** at context construction: `Reflect`, `Proxy`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`. These otherwise resolve via the V8 default realm even with `codeGeneration.strings: false`.
   - **Allowed extras** (opt-in via `extraGlobals`): `fetch` (domain-restricted), `fs.readFile` (path-restricted), `crypto` (hashing only). Each opt-in is a CodeSandbox config field, not an automatic exposure.
4. The `EmergentJudge` (LLM-as-judge) reviews the tool for safety, correctness, determinism, and schema compliance.
5. If approved, the tool is registered at session scope and available for future turns via the `call_forged_tool` meta-tool (no re-forge required).

**Example:** The Medical department faces a radiation crisis. It forges a `radiation_dose_calculator` that computes cumulative dose from exposure rate and duration. The tool passes judge review and is registered. On the next turn, the same department uses the calculator to project 10-year exposure trends.

Tools start at session scope and can be promoted:
- Session → Agent (5+ uses, >0.8 confidence, two-reviewer panel)
- Agent → Shared (human approval required)

**Forge observability chain.** Every forge attempt (approved or rejected) threads through five AgentOS utilities for live health tracking:

```
wrapForgeTool        normalize LLM args, run pre-judge shape check, capture every attempt
   │                 (source: @framers/agentos/emergent)
   ▼
inferSchemaFromTestCases   rescue forges with concrete testCases but no declared properties
   │                 (source: @framers/agentos/emergent)
   ▼
validateForgeShape   pre-judge rejections short-circuit the judge LLM call
   │                 (source: @framers/agentos/emergent)
   ▼
EmergentJudge        LLM-as-judge safety + correctness review
   │
   ▼
capture callback     feeds CapturedForge into paracosm's per-dept bucket
   │                 (paracosm/src/runtime/orchestrator/index.ts)
   ▼
ForgeStatsAggregator aggregates attempts + classifies rejection reasons
   │                 (source: @framers/agentos/emergent; composed into CostTracker)
   ▼
SSE forge_attempt   live dashboard card per forge
SSE _cost.forgeStats  live approval-rate + histogram on every subsequent event
finalCost().forgeStats land in the run artifact JSON
/retry-stats.forges   cross-run rollup over last 100 completed runs
```

Rejection categories (from `classifyForgeRejection`): `schema_extra_field`, `shape_check`, `syntax_error`, `parse_error`, `judge_correctness`, `other`. A growing `other` bucket is the signal to read raw rejection text and extend the pattern set. See [AgentOS Emergent Capabilities: Forge Observability](https://docs.agentos.sh/docs/architecture/emergent-capabilities#forge-observability) for the full five-utility API.

### HEXACO Personality Model

Each commander and colonist has a HEXACO personality profile (Ashton & Lee, 2007): six orthogonal trait dimensions measured on a [0, 1] scale.

| Trait | Dimension | High value | Low value |
|-------|-----------|------------|-----------|
| H | Honesty-Humility | Sincere, fair | Self-interested, status-seeking |
| E | Emotionality | Empathetic, anxious | Detached, stoic |
| X | Extraversion | Sociable, assertive | Reserved, quiet |
| A | Agreeableness | Patient, cooperative | Critical, confrontational |
| C | Conscientiousness | Disciplined, thorough | Flexible, spontaneous |
| O | Openness | Creative, curious | Conventional, practical |

In Paracosm, HEXACO influences:

- **Commander decisions**: conditional cues fire at the 0.7 / 0.3 poles, translating trait values into concrete behavioral implications (e.g., high openness → "the unknown is opportunity, not threat"; high conscientiousness → "you would rather be slow and right than fast and wrong").
- **Colonist reactions**: per-agent reaction blocks include cue strings from `buildReactionCues` so reacting agents don't have to re-derive personality behavior from a vector each call. All six axes have both-pole cues.
- **Personality drift**: all six traits drift turn-over-turn from experience. Three forces combine per trait:
  - *Leader pull*: trait value converges toward the commander's (Van Iddekinge 2023)
  - *Role pull*: department role activates specific traits (Tett & Burnett 2003)
  - *Outcome pull*: every (trait, outcome) pair has a peer-reviewed sign (Silvia & Sanders 2010 for openness; Roberts et al. 2006 for conscientiousness; Smillie et al. 2012 for extraversion; Graziano et al. 2007 for agreeableness; Lee & Ashton 2004 for emotionality; Hilbig & Zettler 2009 for honesty-humility)
  - Rate-capped at ±0.05/turn; bounds [0.05, 0.95]
- **Commander drift**: the commander's HEXACO evolves alongside agents. The runtime clones `actor.hexaco` at run start and applies outcome-pull after every turn's resolution. The final output carries both the drifted `hexaco`, the original `hexacoBaseline`, and a per-turn `hexacoHistory` for trajectory visualization. The caller's `ActorConfig` is never mutated.
- **Trajectory cues**: commander, director, and department-head prompts all receive a one-line cue describing drift since turn 0 ("Since you took command, your personality has drifted substantially toward higher openness and measurably away from higher conscientiousness. Notice how recent decisions have shaped your judgment."). Threshold 0.05 matches the per-turn rate cap.
- **Chat memory retrieval**: AgentOS uses HEXACO to modulate which memories surface during character chat.

### Parallel Execution

Pair runs (exactly 2 commanders) fan out via `Promise.all` in `pair-runner.ts`. Cohort runs (3+ commanders) fan out through a bounded worker pool in `runBatchSimulations`, sized to `economics.batch.maxConcurrency` (default 8) so the swarm lands as a sequence of batches that stay within provider rate limits regardless of how many leaders are in flight. Within each commander's turn, all department analyses also run in parallel. This produces independent timelines from the same starting conditions:

```
Turn N:
  Commander A (Promise.all[0]):
    Departments [medical, engineering, agriculture, psychology, governance] → Promise.all
    Commander decision
    Outcome + effects
  Commander B (Promise.all[1]):
    Departments [medical, engineering, agriculture, psychology, governance] → Promise.all
    Commander decision
    Outcome + effects
```

The Event Director generates different crises for each commander based on their colony's current state. Same seed controls the deterministic kernel, but the LLM-generated crises diverge based on accumulated state differences.

## The Agent Swarm

Every paracosm run produces a swarm: ~100 named agents with departments, roles, family edges, mood, and short-term memory. The swarm is hierarchical, not bottom-up emergent: one leader directs strategy, five specialist departments report, and the cell population reacts to the resulting world state. See [`docs/positioning/world-model-mapping.md`](positioning/world-model-mapping.md) for the contrast against bottom-up swarm intelligence simulators (OASIS, MiroFish).

### Swarm shape

```
┌──────────────────────────┐
│         Leader           │   1 commander, HEXACO-typed,
│  (CEO / general / AI…)   │   personality drifts each turn
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│  5 specialist depts      │   Engineering · Medical · Agriculture
│  (per scenario hooks)    │   · Psychology · Governance (Mars defaults)
└─────────────┬────────────┘
              ▼
┌──────────────────────────┐
│  ~100 personality cells  │   Each has HEXACO, role, mood,
│  (born + die + reproduce)│   social edges, persistent memory
└──────────────────────────┘
```

### Per-agent state

Every cell carries state defined in [`src/engine/core/state.ts`](../src/engine/core/state.ts) — `core` (id, name, department, role), `health` (alive, psychScore, conditions), `career` (rank, achievements), `social` (partnerId, childrenIds, friendIds), `narrative` (lifeEvents, featured), `hexaco` (six-axis personality), `hexacoHistory` (drift over turns), and `memory` (shortTerm, longTerm, stances, relationships sentiment map).

The leader and each specialist also carry HEXACO profiles. Personality drift propagates across the swarm via three mechanisms (see [HEXACO Personality Model](#hexaco-personality-model)).

### Swarm exposure on the public API

The swarm is first-class on every consumer surface:

| Surface | Access |
|---|---|
| **`RunArtifact.finalSwarm`** | End-of-run snapshot: every agent's id, name, dept, role, alive flag, mood, family edges, last memories. |
| **`paracosm/schema`** | `SwarmAgent` and `SwarmSnapshot` Zod schemas + TypeScript types. |
| **`paracosm/swarm`** | Pure projections: `getSwarm`, `swarmByDepartment`, `swarmFamilyTree`, `aliveCount`, `deathCount`, `moodHistogram`, `departmentHeadcount`. |
| **`paracosm`** | `WorldModel.swarm(artifact)` and the same helpers as static methods. |
| **HTTP** | `GET /api/v1/runs/:runId/swarm` returns just the swarm snapshot — lighter than the full artifact. |
| **SSE stream** | `systems_snapshot` event fires every turn with the full agent roster + per-turn births/deaths/morale. |

```ts
import { getSwarm, swarmByDepartment, moodHistogram } from 'paracosm/swarm';

const swarm = getSwarm(runArtifact);
if (swarm) {
  console.log(`T${swarm.turn}: ${swarm.population} alive, morale ${Math.round((swarm.morale ?? 0) * 100)}%`);
  console.log(moodHistogram(swarm)); // { focused: 12, anxious: 5, ... }
}
```

The SSE `systems_snapshot` event is what drives the live LivingSwarmGrid viz on the dashboard — same shape, streamed per turn instead of persisted.

### Why top-down, not bottom-up

Bottom-up swarm simulators (OASIS, MiroFish, classical ABM) put behavior in each agent and wait for emergent collective dynamics to surface. Paracosm puts behavior in the *leader*, treats the swarm as a population that reacts to leader decisions, and measures divergence by swapping leaders.

The economic argument: a 1000-agent bottom-up sim runs ~1000 LLM calls per turn ($10–$100/run minimum). A 100-agent top-down sim runs ~10 LLM calls per turn (~$0.10–$1/run). The top-down shape keeps cost in the right band for decision-support usage while still producing measurable per-agent state. Swarm dynamics that need richer per-cell autonomy land as opt-in `swarmDynamics` modes (Phase 2 spec, not yet shipped).

## Post-Simulation

### LLM Verdict

After a pair run completes all turns, an LLM compares the two commanders' final states and produces a verdict. Cohort runs (N >= 3) skip the verdict because pairwise comparison is ambiguous across N; the dashboard surfaces group-median deltas and the constellation view instead.

```json
{
  "winner": "A",
  "winnerName": "Aria Chen",
  "headline": "Bold expansion outpaced cautious engineering",
  "summary": "Chen's high openness led to riskier decisions that paid off in population growth...",
  "keyDivergence": "Turn 3 dust storm response: Chen sent exterior repair crews while Voss reinforced from inside",
  "scores": {
    "a": { "survival": 8, "prosperity": 9, "morale": 6, "innovation": 9 },
    "b": { "survival": 9, "prosperity": 7, "morale": 7, "innovation": 5 }
  }
}
```

The verdict is broadcast as an SSE `verdict` event and rendered in the dashboard as a comparison card with score bars.

### Character Chat

After the simulation, users can chat with any colonist. Each colonist is a full AgentOS `agent()` instance with:

- **HEXACO personality** passed to `agent({ personality: { ... } })`
- **Episodic memory** seeded with their simulation experiences (reactions, crises, department reports, decisions)
- **Full conversation history** managed automatically by `session.send()`
- **RAG retrieval** before each turn: `memory.getContext()` retrieves relevant simulation memories

This prevents the contradictions that plagued the old system. The colonist cannot claim Yoruba heritage in one message and deny it in the next because both statements are stored in episodic memory and retrieved by the RAG pipeline.

Agents are created lazily on first chat message (~2-3s init) and pooled (max 10, LRU eviction).

## API

### Universal Schema (`paracosm/schema`)

Every `WorldModel.simulate()` call returns a `RunArtifact`: one Zod-validated shape covering all simulation modes. The subpath `paracosm/schema` exports the schemas + inferred TypeScript types:

```typescript
import { RunArtifactSchema, StreamEventSchema, type RunArtifact } from 'paracosm/schema';
```

**Thirteen content primitives:**

| Primitive | Role |
|---|---|
| `RunMetadata` | runId, scenario, mode, seed, timestamps |
| `WorldSnapshot` | 5-bag state (metrics / capacities / statuses / politics / environment) |
| `SwarmAgent` | public, serializable view of one agent: id, name, dept, role, alive, mood, family edges, recent memory |
| `SwarmSnapshot` | full population at a point in time: agents[], population, morale, births, deaths |
| `Score` | bounded numeric score with explicit min/max/label |
| `HighlightMetric` | featured metric card (label + formatted value + direction) |
| `Timepoint` | labeled snapshot: narrative + score + highlight metrics + world snapshot |
| `TrajectoryPoint` | lightweight metric sample (sparkline-ready) |
| `Trajectory` | time-unit-labeled series (`points[]` + `timepoints[]`) |
| `SpecialistNote` | thin domain analysis (summary + trajectory + confidence) + optional thick detail |
| `RiskFlag` | callout with severity (low / medium / high) |
| `Decision` | chosen action (commander decision, intervention, policy) |
| `Citation` | DOI-linked evidence |

**Plus operational:** `Cost` (USD + token breakdown) and `ProviderError` (classified terminal error).

**Mode discriminator on `metadata.mode`:**

- `turn-loop`: paracosm civ-sims. Populates `trajectory.timepoints[]`, `decisions[]`, per-turn specialist notes.
- `batch-trajectory`: digital-twin simulations. Populates `trajectory.timepoints[]` as a forecast + specialist notes + risk flags.
- `batch-point`: one-shot forecast. Overview + risk flags, no trajectory.

**`StreamEvent`** is a 17-variant discriminated union over every SSE event type the runtime emits (`turn_start`, `event_start`, `specialist_start`, `specialist_done`, `forge_attempt`, `decision_pending`, `decision_made`, `outcome`, `personality_drift`, `agent_reactions`, `bulletin`, `turn_done`, `promotion`, `systems_snapshot`, `provider_error`, `validation_fallback`, `sim_aborted`).

**Scenario-specific extensions.** Every primitive carries an optional `scenarioExtensions?: Record<string, unknown>` escape hatch. Mars radiation fields, digital-twin genome markers, game inventory state: all live here without polluting the universal shape.

**JSON Schema export.** `npm run export:json-schema` regenerates `schema/run-artifact.schema.json` + `schema/stream-event.schema.json` so non-TypeScript consumers (Python `datamodel-codegen`, Go, Rust, etc.) can generate equivalent types.

### HTTP Endpoints

Two surfaces:

**Demo runtime** (the local dashboard server — single-tenant, ephemeral state)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/setup` | Start a new simulation with leaders, turns, seed, departments |
| `GET` | `/events` | SSE stream of simulation events (`systems_snapshot` carries the swarm) |
| `POST` | `/clear` | Clear simulation state and chat agent pool |
| `POST` | `/chat` | Chat with a colonist agent |
| `GET` | `/results` | Full simulation results including verdict |
| `GET` | `/rate-limit` | Check rate limit status |
| `POST` | `/compile` | Compile a custom scenario draft with optional `seedText` / `seedUrl` grounding |
| `GET` | `/retry-stats` | Cross-run reliability rollup (schemas + forges + caches + providerErrors) over the last N completed runs. Query param: `?limit=N` |

**Platform API** (multi-tenant, run history persisted — see [`docs/HTTP_API.md`](HTTP_API.md))

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/runs` | List runs newest-first with filters |
| `GET` | `/api/v1/runs/aggregate` | Rollup counters over the filtered set |
| `GET` | `/api/v1/runs/:runId` | Full RunArtifact JSON |
| `GET` | `/api/v1/runs/:runId/swarm` | Final agent-swarm snapshot (lightweight) |
| `POST` | `/api/v1/runs/:runId/replay` | Re-execute the kernel; report byte-for-byte match |
| `GET` | `/api/v1/bundles/:bundleId` | Quickstart-bundle metadata + member RunRecords |
| `POST` | `/api/v1/library/import` | Import an externally-produced RunArtifact |
| `GET` | `/api/v1/demo/status` | Public-demo capability flags |

### Reliability telemetry (`/retry-stats`)

Every Zod-validated LLM call site reports `{ attempts, calls, fallbacks }` to the run-scoped cost tracker. Every forge attempt reports `{ approved, confidence, name, errorReason }`. Every LLM call that throws gets classified by the provider-error classifier. Every cache hit/write on supported providers increments the cache tracker. On run completion the server snapshots the per-run rollup into a rotating ring of the last 100 runs (`.retry-stats.json` on disk).

`GET /retry-stats` aggregates the ring into a unified response:

```json
{
  "runCount": 87,
  "schemas": {
    "DepartmentReport":     { "calls": 2608, "attempts": 2721, "fallbacks": 3, "avgAttempts": 1.04, "fallbackRate": 0.0012, "runsPresent": 87 },
    "CommanderDecision":    { "calls": 1056, "attempts": 1089, ... },
    "compile:fingerprint":  { "calls": 87,  "attempts": 87, ... },
    "compile:politics":     { "calls": 87,  "attempts": 87, ... }
  },
  "forges": {
    "totalAttempts": 1420, "approved": 1180, "rejected": 240,
    "approvalRate": 0.8310, "avgApprovedConfidence": 0.92,
    "totalUniqueNames": 1020, "totalUniqueApproved": 1015,
    "totalUniqueTerminalRejections": 5,
    "uniqueApprovalRate": 0.9951,
    "rejectionReasons": {
      "schema_extra_field": 210, "shape_check": 18,
      "parse_error": 4, "judge_correctness": 8, "other": 0
    },
    "runsPresent": 72
  },
  "caches": {
    "totalReadTokens": 18420000, "totalCreationTokens": 2800000,
    "totalSavingsUSD": 42.35, "readRatio": 0.8681, "runsPresent": 65
  },
  "providerErrors": {
    "auth": 0, "quota": 12, "rate_limit": 28, "network": 2, "unknown": 4,
    "total": 46, "runsPresent": 18
  }
}
```

Interpretation:

- `schemas.compile:*`: compiler hook generation reliability. `fallbackRate > 0` on a `compile:*` entry means silent-degradation compiles landed on the host (investigate via `compile_validation_fallback` SSE events).
- `forges.approvalRate`: attempt-level including retries. `uniqueApprovalRate` is the real quality signal: unique tools that landed in the toolbox / unique names attempted.
- `forges.rejectionReasons`: failure-mode histogram. A dominant `schema_extra_field` bucket means the LLM is declaring strict output schemas then returning extra fields (the 2026-04-18 forge-guidance prompt fix targets this).
- `caches.readRatio` < 0.7 means the cache keeps getting invalidated. Zero `caches` fields mean the provider doesn't expose cache counters (OpenAI auto-caches opaquely; Anthropic reports).
- `providerErrors.auth` + `.quota` are terminal (run aborts). `.rate_limit` + `.network` + `.unknown` are non-terminal; the retry layer handles them.

`avgAttempts > 1.2` on a schema means the model is retrying on validation failure often enough to be worth tuning. `fallbackRate > 0` means the run served degraded data on at least one turn.

### Custom scenarios: compile before running

Source scenarios (`<name>.json`) are sparse authoring files. They must be **compiled** before the runtime can execute them. Compilation generates six hooks (progression, prompts, fingerprint, politics, reactions, director instructions, milestones) via LLM calls (~$0.10 once, then disk-cached).

Dashboard flow:

1. Paste or load JSON into the Scenario Editor.
2. Click **Compile**: watches the SSE progress stream (`compile_hook` events per hook generated). Cost is billed against the user-supplied API key when provided, else the host's.
3. After `compile_done`, the scenario is both added to `customScenarioCatalog` AND set as the active scenario. The Sim tab will run it on the next RUN click.

Common mistake: clicking **Store** (saves the JSON draft, does not generate hooks) and then hitting RUN. The run proceeds with whichever scenario was previously active (Mars by default): the editor still shows Mercury, the page title pulls the label from the stored JSON, but the simulation runs Mars. Fix: click Compile, not Store.

Programmatic flow:

```ts
import { WorldModel, compileScenario } from 'paracosm';
import sourceJson from './mission-mercury.json';

const scenario = await compileScenario(sourceJson, { provider: 'anthropic', model: 'claude-sonnet-4-6' });
const wm = WorldModel.fromScenario(scenario);
await wm.simulate({ actor: leader, keyPersonnel: personnel, maxTurns: 8 });
```

The runtime `scenario` parameter MUST be a compiled `ScenarioPackage` (has `hooks`), not the raw source JSON.

### npm Package Exports

| Import | What |
|--------|------|
| `paracosm` | Root API: `run`, `runMany`, `WorldModel`, built-in scenarios, engine types, registries, kernel |
| `paracosm/compiler` | `compileScenario()` |
| `paracosm/swarm` | Pure swarm projections: `getSwarm`, `swarmByDepartment`, `swarmFamilyTree`, `aliveCount`, `deathCount`, `moodHistogram`, `departmentHeadcount` |
| `paracosm/schema` | Universal schemas + types (`RunArtifact`, `SwarmAgent`, `SwarmSnapshot`, …) |
| `paracosm/digital-twin` | `DigitalTwin` alias plus subject + intervention types |
| `paracosm/core` | Kernel internals (`SimulationKernel`, `SeededRng`) and state types for low-level consumers |

### Programmatic Usage

```typescript
import { WorldModel, compileScenario } from 'paracosm';

const scenario = await compileScenario(worldJson, { provider: 'anthropic' });
const wm = WorldModel.fromScenario(scenario);

const result = await wm.simulate({
  actor: leader,
  maxTurns: 6,
  seed: 42,
  onEvent(e) { console.log(e.type, e.data?.title); },
});

console.log(result.finalState?.metrics.population);
console.log(result.forgedTools?.length ?? 0);
```

### Replay (T5.5)

```typescript
import { WorldModel } from 'paracosm';

const wm = WorldModel.fromScenario(myScenario);
const trunk = await wm.simulate({ actor: leader, maxTurns: 6, captureSnapshots: true });

// Audit: did the kernel change since this run was produced?
const replay = await wm.replay(trunk);
console.log(replay.matches);     // true when nothing in the kernel diverged
console.log(replay.divergence);  // empty when matches=true; JSON pointer otherwise
```

`replay()` re-executes the kernel's between-turn progression hook from each recorded snapshot, captures fresh snapshots, and compares them to the input via canonical JSON. Cost: zero LLM. Wall-clock: dominated by JSON parse plus per-turn kernel state advancement. `matches=true` proves the kernel's progression is byte-equal-deterministic for this artifact's transitions, which is the audit guarantee.

Required preconditions on the input artifact:

- `scenarioExtensions.kernelSnapshotsPerTurn` populated (parent created with `captureSnapshots: true`).
- `decisions[]` populated.

Throws `WorldModelReplayError` when either is missing or when the artifact's scenario id does not match the WorldModel's scenario.

Scope note: v1 replay re-runs `advanceTurn` only. Re-applying recorded decisions via `kernel.applyPolicy` is a follow-up once the public RunArtifact preserves enough department-report context for `decisionToPolicy` to reconstruct PolicyEffects faithfully.

#### HTTP surface

The HTTP surface for replay is `POST /api/v1/runs/:runId/replay` on the dashboard server. The endpoint loads the stored artifact via `record.artifactPath`, looks up the original scenario via the in-memory catalog, constructs a `WorldModel`, calls `WorldModel.replay(artifact)`, and persists the outcome via `runHistoryStore.recordReplayResult(runId, matches)`. Returns `{ matches: boolean, divergence: string }` on 200, structured errors on 404 / 410 / 422. The client-side hook is `src/dashboard/src/components/library/hooks/useReplayRun.ts`.

### Digital-twin subpath (T5.4)

```typescript
import { DigitalTwin, type SubjectConfig, type InterventionConfig } from 'paracosm/digital-twin';

const twin = await DigitalTwin.fromJson(scenarioJson);
const subject: SubjectConfig = { id: 'company', kind: 'organization', attributes: { headcount: 100 } };
const intervention: InterventionConfig = { id: 'rif', kind: 'policy', description: '25% RIF', parameters: { percent: 25 } };

const artifact = await twin.intervene({ subject, intervention, actor: leader, maxTurns: 4 });
console.log(artifact.subject, artifact.intervention);
```

`paracosm/digital-twin` is a curated re-export of `WorldModel` aliased as `DigitalTwin` plus the `SubjectConfig` and `InterventionConfig` types. The class is identical to `WorldModel`; the alias names the use case in the import path. `intervene({ subject, intervention, actor, ...options })` is sugar over `simulate({ actor, ...options, subject, intervention })` that returns a `RunArtifact` with both fields populated for traceability.

### Schema breaking-change gate (T6.2)

`tests/engine/schema/breaking-change-gate.test.ts` fails any PR that diverges `RunArtifactSchema.shape` without bumping `COMPILE_SCHEMA_VERSION`. The committed snapshot fixture at `tests/engine/schema/run-artifact-schema-snapshot.json` is the canonical source of truth.

Updating the schema:

1. Edit the schema in `src/engine/schema/`.
2. Bump `COMPILE_SCHEMA_VERSION` in `src/engine/compiler/cache.ts`.
3. Run `npm run snapshot:schema` to regenerate the fixture.
4. Commit the schema change, the version bump, and the fixture together.

## Built on AgentOS

Paracosm uses AgentOS for all agent orchestration, LLM calls, tool forging, and memory:

| AgentOS API | Used For |
|------------|----------|
| `agent()` + `session()` | Commander, department, and chat colonist agents (conversation memory) |
| `generateObject()` | Zod-validated one-shot calls (director, reactions, verdict) via `generateValidatedObject` |
| `session.send()` + Zod validation | Session-aware Zod-validated calls (commander, departments, promotions) via `sendAndValidate` |
| `ObjectGenerationError` | Typed error surfaced on exhausted retries; wrappers fall back to empty skeleton + emit `validation_fallback` SSE |
| `extractJson` | Multi-strategy JSON extraction (code fence, thinking-tag strip, greedy brace match) used by `sendAndValidate` |
| `SystemContentBlock` w/ `cacheBreakpoint` | Stable system prefixes cached at 0.1× cost across turns (director instructions, dept system prompt, reaction batch system) |
| `EmergentCapabilityEngine` | Runtime tool forging in a hardened node:vm sandbox |
| `EmergentJudge` | LLM-as-judge safety review of forged tools |
| `AgentMemory.sqlite()` | Colonist chat memory with episodic storage and RAG |
| HEXACO personality | Trait-modulated decision making, memory retrieval, mood adaptation |

## Top-level `src/` layout

```
src/
├── engine/      Scenario kernel + compile-time. Compiler runs ONCE; kernel is deterministic.
│   ├── core/        deterministic kernel (RNG, state, progression, personality drift)
│   ├── compiler/    JSON → ScenarioPackage compiler (LLM-driven, runs once)
│   ├── schema/      foundational types and Zod validators
│   ├── scenarios/   built-in scenario loaders (mars, lunar)
│   ├── physics/     physics modules registry
│   ├── traits/      HEXACO + AI-agent trait registries
│   ├── presets/     actor presets
│   ├── provider/    provider key resolution + credentials
│   ├── digital-twin/  public-API alias barrel for WorldModel as DigitalTwin
│   ├── data-driven-hooks/
│   └── registries/  effects, events, metrics
│
├── runtime/     Per-turn simulation execution. LLM-driven orchestration.
│   ├── orchestrator/  turn pipeline (director → kernel → departments → commander → reactions)
│   ├── agents/        chat-agents, agent-memory, agent-reactions, cues/
│   ├── world-model/   WorldModel façade (replay, fork, snapshot)
│   ├── swarm/         pure projections over RunArtifact swarm view
│   ├── research/      citation/research memory
│   ├── validators/    Zod validators for LLM responses (commander, department, director, verdict)
│   ├── economics/     cost-tracker, pricing, economics-profile
│   ├── io/            output-writer, build-artifact, sse-envelope, citations-catalog, canonical-json, world-snapshot
│   └── util/          parsers, runtime-helpers, provider-errors, generic-fingerprint
│
├── llm/         Shared LLM helpers (generateValidatedObject, sendAndValidate). Imported by engine/compiler and runtime.
├── api/         Public run/runMany surface. The 90% case for paracosm consumers.
├── cli/         CLI entry points (run, run-a, run-b, compile, init, serve, help) + scenario-config helpers.
├── server/      HTTP server. Subdivided into routes/, stores/, services/.
└── dashboard/   Vite/React UI. Talks to server/ via fetch.
```

`engine/` does NOT import `runtime/` (enforced by `scripts/check-engine-runtime-boundary.mjs`, which runs as part of `npm test`). One barrel file is exempt: `src/engine/digital-twin/index.ts`, the public-API alias for `WorldModel as DigitalTwin`.

For the contributor reference (where new code goes, naming conventions, public-export-to-internal-path mapping), see [`architecture/INTERNAL_LAYOUT.md`](architecture/INTERNAL_LAYOUT.md).

## AgentOS API surface used by paracosm

Paracosm depends on a small surface of `@framers/agentos`. Six distinct symbols across eight files:

| Symbol | Used in |
|---|---|
| `ITool` (type) | `runtime/orchestrator/index.ts`, `runtime/orchestrator/emergent-setup.ts` |
| `AgentMemory` (class) | `runtime/agents/chat-agents.ts` |
| `agent` (factory) | `runtime/agents/chat-agents.ts` |
| `generateObject` | `llm/generateValidatedObject.ts` |
| `ObjectGenerationError` | `llm/generateValidatedObject.ts`, `llm/sendAndValidate.ts` |
| `extractJson` | `llm/sendAndValidate.ts` |

The shared LLM primitives (`generateValidatedObject`, `sendAndValidate`) own four of the six symbols and live in `src/llm/`. Higher-level callers (`runtime/orchestrator/`, `runtime/agents/chat-agents.ts`) import the remaining symbols directly. No paracosm-side adapter layer; the surface is small enough that direct imports are clearer than indirection.

## References

- Ashton, M. C., & Lee, K. (2007). Empirical, theoretical, and practical advantages of the HEXACO model of personality structure. *Personality and Social Psychology Review*, 11(2), 150-166. [hexaco.org](https://hexaco.org/)
- Lee, K., & Ashton, M. C. (2004). Psychometric properties of the HEXACO personality inventory. *Multivariate Behavioral Research*, 39(2), 329-358.
- Roberts, B. W., Walton, K. E., & Viechtbauer, W. (2006). Patterns of mean-level change in personality traits across the life course. *Psychological Bulletin*, 132(1), 1-25.
- Graziano, W. G., et al. (2007). Agreeableness, empathy, and helping: A person × situation perspective. *Journal of Personality and Social Psychology*, 93(4), 583-599.
- Silvia, P. J., & Sanders, C. E. (2010). Why are smart people curious? Fluid intelligence, openness to experience, and interest. *Personality and Individual Differences*, 49(3), 242-245.
- Smillie, L. D., et al. (2012). Extraversion and reward-processing: Consolidating evidence from an electroencephalographic index of reward-prediction-error. *European Journal of Personality*, 26(5), 508-521.
- Hilbig, B. E., & Zettler, I. (2009). Pillars of cooperation: Honesty-Humility, social value orientations, and economic behavior. *Journal of Research in Personality*, 43(3), 516-519.
- Tett, R. P., & Burnett, D. D. (2003). A personality trait-based interactionist model of job performance. *Journal of Applied Psychology*, 88(3), 500-517.
- Van Iddekinge, C. H. (2023). Leader-follower personality similarity and work outcomes: A meta-analysis. *Journal of Management*.
- AgentOS documentation: [docs.agentos.sh](https://docs.agentos.sh)
- AgentOS Emergent Capabilities: [docs.agentos.sh/features/emergent-capabilities](https://docs.agentos.sh/docs/features/emergent-capabilities)
- AgentOS Cognitive Memory: [docs.agentos.sh/features/cognitive-memory](https://docs.agentos.sh/docs/features/cognitive-memory)
- AgentOS HEXACO Personality: [docs.agentos.sh/features/hexaco-personality](https://docs.agentos.sh/docs/features/hexaco-personality)
