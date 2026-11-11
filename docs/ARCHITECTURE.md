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
  "setup": { "defaultTurns": 6, "defaultSeed": 950, "mortalityDice": "life", "defaultStartTime": 2035, "defaultTimePerTurn": 8 },
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

**Terminology.** The `labels.populationNoun` (plural, e.g. `colonists` → `crew` → `subjects`) and `labels.settlementNoun` (singular, e.g. `colony` → `habitat` → `kingdom`) fields flavour every user-facing string in the dashboard: help legends, roster headers, empty states, ARIA labels, report copy. The engine defaults to `colonists` / `colony` when omitted (Mars heritage), but non-Mars scenarios should override both. Singular/capitalized variants are derived automatically by the dashboard's `useScenarioLabels()` hook. The run's prompts read the same labels through [`scenario-words.ts`](../src/runtime/util/scenario-words.ts), `labels.actorNoun` naming the leader, and read the world through [`scenario-state.ts`](../src/runtime/util/scenario-state.ts): the kernel seeds its Mars-heritage metrics and politics (power, food, water, pressurized volume, life support, modules, science, Earth dependency, governance, independence pressure) only in a run whose scenario declares them in `world`, or a run with no scenario, so a run's state, turn events, outcome effects and saved run carry only what its scenario declares, plus the population and morale every run has. Progression reads food and life support only where a run carries them. A saved run that carries the Mars defaults loads, forks and replays with them, and a prompt names them only when the scenario declares them.

**Death dice.** `setup.mortalityDice` says how each person's death dice are kept: `"year"` (the default), a die of its own for each cause in each year, or `"life"`, one die for each cause for the person's whole life. Mars Genesis declares `"life"`, and so does a run given no scenario, which runs Mars Genesis, kernel included. Lunar Outpost, the deep-ocean station, Atlas Lab, the Digital Twin and a `SimulationKernel` constructed with no scenario keep a die a year. The kernel records the choice in `metadata.mortalityDice`, so a saved run and a fork of one keep the dice they were saved with. See Mortality below.

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
RESEARCH MEMORY                 (AgentOS AgentMemory.sqlite, one per run: full-text recall)
  ↓ per event
research.recall(query, keywords, category)  (memory recall within the category's topics)
  ↓
LIVE SEARCH OR BUNDLE           (with liveSearch on: `aggressive` always searches, `adaptive`
                                  when recall found under 2 facts, `gated` when it found none;
                                  no search or no results: the recalled facts, or the bundle)
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

Each run makes its own research memory at its start and closes it at its end, so the two leaders of a pair share no store and no recall cache, and the first to finish leaves the other's untouched. A scenario reads only its own bundle: one with no citations (Atlas Lab ships none) gets empty packets. A milestone event reads the bundle by category. A recalled packet carries the facts the store found among the topics of the event's category (any topic, when the bundle does not map the category), with that category's counterpoints and department notes.

The Event Director also receives the knowledge bundle's `topics` and `categories`. Its `researchKeywords` and `category` fields stay grounded in actual citation entries, so retrieval downstream finds matches.

### Scenario Compiler

The compiler turns a scenario JSON draft plus optional prompt/document/URL grounding into a runnable `ScenarioPackage` by generating TypeScript hook functions via LLM calls:

| Hook | What it generates | Called when |
|------|-------------------|------------|
| `progressionHook` | Between-turn state updates (radiation, bone density, etc.); it gets the step as `timeDelta` in the scenario's unit and as `yearsDelta` in years, with `yearsSinceStart` and `yearsPerUnit` | Between turns, once for each year a turn spans and once for a part of a year left over (see Mortality) |
| `departmentPromptHook` | Department-specific analysis context | Before each department analyzes |
| `fingerprintHook` | Timeline classification from final state | After simulation completes |
| `politicsHook` | Political/social effects for each category and outcome | After each event's outcome |
| `getMilestoneEvent` | Fixed narrative events (Turn 1 founding, final assessment) | Turn 1 and final turn |
| `reactionsHook` | Colonist personality-aware reactions | After each commander decision |

Compilation costs ~$0.10 and is cached to disk. The compiler accepts `--seed-text` and `--seed-url` for domain research, and `--no-web-search` to skip web enrichment. A future prompt-only wrapper should first generate this same JSON contract, then validate and compile it.

### Deterministic Kernel

The `SimulationKernel` manages all numerical state. It is deterministic: given the same seed, the same commander decisions and the same department reports, it produces identical outcomes. What the seed fixes, what the model decides and what stops the model from moving the numbers, in plain words: [FAQ](FAQ.md#what-decides-what-happens-in-a-run-the-dice-or-the-model).

The kernel tracks:
- **Colony metrics**: population, morale, food reserves, power, infrastructure modules, science output
- **Agent population**: each colonist has health (alive, psychScore, conditions), career (role, rank, specialization), social (partner, children, friends), and narrative (featured, quotes) data. Generated people work in the scenario's own departments, under their labels; Mars Genesis keeps its own trades
- **Progression**: between-turn updates (aging, mortality, births, career advancement, personality drift). Ages, experience and the yearly rates are in years: the kernel converts a turn's elapsed units with `setup.yearsPerTimeUnit`, else the length of the unit `labels.timeUnitNoun` names (year 1, quarter 1/4, month 1/12, week 1/52, day 1/365, hour 1/8760, any other word 1), and keeps the factor in `metadata.yearsPerUnit`, which snapshots carry. A state saved without it reads 1.

**An event's outcome.** Each event's options declare only whether they are risky (`isRisky`), and the event declares `riskSuccessProbability`, the risky option's chance of success. The run's state moves that chance (morale above 0.7 adds 0.1, a food store above 12 months adds 0.05 in a run that carries one, a population above 150 takes 0.05), within 0.1 and 0.9. A safe option halves the risky option's chance of failure: its chance is `(1 + risky) / 2`, between 0.55 and 0.95, so it always has the better chance and can still fail. The rule is fixed in the engine because no option carries a probability of its own. The run makes one draw per event, from the run's seed, the turn and the event's index, so both leaders of a pair run face the same luck; the draw meets the chosen option's chance, and on one draw a risky option can fail where a safe one succeeds. The chosen option is the decision's `selectedOptionId` when the event offers it (by id, or by label written where the id goes), else the option the decision's text names (`resolveChosenOption`); an id the event does not offer is not a choice. A decision that names no option reads as safe, as when the commander's reply falls back to deferring to the departments. The outcome is `risky_success`, `risky_failure`, `conservative_success` or `conservative_failure` ([`progression.ts`](../src/engine/core/progression.ts), `outcomeSuccessChance`). A saved run keeps the outcomes it recorded: replay re-runs the between-turn steps from its snapshots and never draws an outcome again.

Four things move the numbers during a turn. The first three add to the value they name, within the range the scenario declares (`min` and `max` in `world.metrics`, `world.capacities` and `world.politics`); the fourth moves people:

- **A selected policy effect.** The effects a commander selects are added to the current values, and two on one key add up. Every department numbers its effects from `effect_1`, so the commander's list names each as `<department>/<id>`, and the commander puts the keys it adopts in `selectedPolicies` (`selectedEffectIds` is read too). A selection reads with the type or the description written after the key (`medical/effect_1 (risk_mitigation)`), and several keys in one string, split by commas or semicolons (`medical/effect_1, engineering/effect_1`), all apply. A key matches as written first, and in another case only when one effect has it; a key that names two effects (two effects under one key, or keys that differ only by case) applies neither. A bare id names an effect only when one report holds it; held by two reports, as `effect_1` usually is, it names neither and is logged with the keys that name two. An effect selected twice counts once. The run logs what moved as `[policy] effects`, each selection that names no effect as `[policy] no effect named by`, and each that names more than one as `[policy] more than one effect named by, none applied`. A report's `proposedPatches` move nothing: they came from every report, whether or not the commander picked from it, and set values outright past one decision's bound, so only selected effects move the state. A patch that names `metrics`, `politics` or `agentUpdates` is logged as `[policy] department patches set nothing`, with what each department asked; one that holds only notes in words, as the live runs' reports do, logs nothing. An effect moves only keys the run holds as numbers in its metrics (capacities included) or its politics: each department's report format lists them with their field (`systemDelta` or `politicsDelta`), label, unit and range, and its example names them (`src/runtime/orchestrator/forge-guidance.ts`). The run validates every report with a schema built for those keys (`departmentReportSchemaFor`), which refuses an effect that names any other key and names the held ones, so the model is asked again. A report that still names one after its retries keeps the rest: the run takes the newest reply that passes the plain report schema (an older one when the last came back as prose with no JSON), drops those keys from its effects (`salvageDepartmentReport`) and logs them as `[<department>] effect keys not held, dropped`, with the keys the run holds, and its summary, risks and held effects stand. The call counts in the run's `schemaRetries.DepartmentReport.salvaged`, and goes out as a `validation_fallback` stream event with `salvaged: true` and the dropped keys in `droppedKeys` (`sendDepartmentReport` in [`department-report.ts`](../src/runtime/orchestrator/department-report.ts)). The empty fallback report, which has no effects, is left for a call none of whose replies passes the plain schema. A key the run does not hold reaches the policy step only from a caller that validated its reports with the plain schema (`DepartmentReportSchema`); it moves nothing and is logged as `[policy] effect keys not held, dropped`, with the keys the run holds, and the turn artifact records it in `policyKeysDropped`.
- **An outcome's category table.** The scenario's `effects` table lists what an event brings at an ordinary response, and scales by outcome. A key moves the metric or the politics value the run holds under it; a key the run holds in neither is dropped. An entry is helpful or harmful by its sign and its key's direction: a fall is harmful on a key that is better higher, a rise on one the scenario's `metrics` declare `better: "lower"` (keyed by the last part of the metric's `source`, or its `id`; a metric with neither names no key and is skipped). With `e` the outcome's multiplier plus the personality, noise and tool modifiers:

  | Outcome | Multiplier | A helpful entry `v` (`v × e`) | A harmful entry `v` (`v × max(0, 2 − e)`) |
  | --- | --- | --- | --- |
  | `risky_success` | 2.5 | 2.5v | 0 |
  | `conservative_success` | 1 | v | v |
  | `conservative_failure` | -1 | -v | 3v |
  | `risky_failure` | -2 | -2v | 4v |

  A failed response loses the gains a good one would bring, and a harmful entry stays a cost: Atlas Lab's `safety_breach` lowers `alignmentBench` by 0.04 at a conservative success and by 0.12 at a conservative failure. A harmful entry in a table that adds people (Atlas Lab's `talent` raises the burn rate with the head count) is their cost and moves by `v × e` with them.

  The tool modifier adds to `e` what the event's departments forged during the event: 0.04 for each approved tool the ledger first recorded this turn, 0.02 for each other approved forge, 0.06 off for each forge the reviewers rejected, and an innovation bonus of `ln(1 + n) × 0.03`, where `n` is the run's tools so far: each approved tool once, the count `turn_done` carries as `toolsForged`. A tool rejected on every forge is not one of them, so it lowers the outcome of its own event and raises none. The modifier stays within -0.5 and 0.5 ([`effects.ts`](../src/engine/registries/effects.ts); `eventToolModifiers` in [`tool-ledger.ts`](../src/runtime/orchestrator/tool-ledger.ts)).
- **The politics hook.** `politicsHook` names a change for each category and outcome. Where it names a key, its change replaces the category table's, so a key moves once. The `outcome` stream event reports what moved in `systemDeltas` and `politicsDeltas`.

  A status moves only where a rule names it, and Mars Genesis names none for `governanceStatus`. The scenario declares it in `world.statuses` with the value `earth-governed` and no rule for a change: its politics table moves `earthDependencyPct` and `independencePressure` by numbers, an effect moves only keys the run holds as numbers, and the policy step applies no department patch. The kernel's type lists `commonwealth` and `independent` beside `earth-governed`, but the scenario sets no level of independence pressure or Earth dependency at which the colony becomes either, so every Mars Genesis run reports `earth-governed` from its first turn to its last. This is a limit of the model: a change of governance needs a rule in the scenario, with its thresholds and the reason for them, before the engine can apply one.
- **A department's update on a person.** A report's `featuredAgentUpdates`, and the `agentUpdates` of a patch a caller hands the kernel itself (`applyPolicy`; the policy step builds none from a report), move a person's psych score toward the value they write, at most 0.15 a turn however many reports and patches name the person, and set the person's conditions as written. A patch may also write a person's career. Neither writes what a physics hook owns or who lives: `cumulativeRadiationMsv`, `boneDensityPct`, `boneDensityBase`, `alive`, `deathTime` and `deathCause` stay as they were, and the keys a patch could not write are named in one `system` event on the log.

**How far one decision moves a key.** One decision's adopted effects move a key at most what one event outcome brings on it at an ordinary response: the largest absolute entry the key has in the scenario's category tables or its politics table (`policyEffectLimits` and `policyEffectBound` in [`commander-policy.ts`](../src/runtime/orchestrator/commander-policy.ts)). On Mars Genesis that is 2 habitat modules, 4 months of food, 60 kW of power, 0.15 of morale, 5 of life-support capacity, 100 litres of water a day, 200 m³ of pressurized volume, 3 of science output, 3 points of Earth dependency and 0.05 of independence pressure. A key no table names moves at most a tenth of its current absolute value, or 1 when it is 0, and one the tables name only with 0 does not move. The kernel moves a head count in whole people, so the bound on `population` rounds down to whole people: no Mars table names it, so a decision on a roster of 25 moves at most 2 people. The tables are read once a run. The bound holds the sum of the decision's selected effects on the key, both fields together, and the scenario's floors and ceilings apply after it, as does the easing of a morale gain above 0.9 (see Morale below). When a key moves otherwise than the effects asked, by the bound, by a floor or ceiling or by that easing, the `[policy] effects` line ends with what they asked (`[policy] effects: {"infrastructureModules":2} asked: {"infrastructureModules":10}`), and the turn artifact records the key in `policyEffectsLimited`, with the event's index, `asked` and `applied`; an `applied` of 0 is a choice that moved nothing. The tables bound an adopted effect and do not price it: an effect costs nothing of its own.

`metrics.population` is always the number of living people on the roster, from the first state on. A population delta rounds to whole people and moves them: joiners are new adults in the departments the roster has, with an `arrival` event; leavers come off the roster with a `departure` event. A departure is not a death: it counts in no mortality figure, the fingerprint's survival rate counts the person as having survived, and nobody new takes the id or the name of someone who left. One delta brings in at most as many people as the roster holds, and hires stop at 2,000 people or the `max` the scenario declares for `population`. Department heads and children do not leave, and a departure stops at the `min` the scenario declares. So a delta can move fewer people than it asks for, while the other deltas of that outcome (a burn rate that moves with the head count) apply in full.

The kernel uses a `SeededRng` (deterministic PRNG) for all random decisions: colonist generation, mortality, births and the other rolls below. Personality drift draws nothing: it is a formula of the leader's traits, the person's department and the event's outcome (`applyPersonalityDrift`). Two simulations with the same seed start with the same people. Every roll the kernel makes that decides something about one person (a death, a birth, a partnership, a friendship, a recovery, a promotion, a lost outside contact) draws from a stream of its own, keyed by the seed, the turn, the step of the turn (each whole year the turn spans, then the part of a year it ends with), the person and what is rolled for (`SeededRng.forDraw`), so two runs of one seed roll the same dice for a person both rosters hold under the same id, and one person's fate never moves another person's dice in those rolls. A scenario can keep each person's death dice for life instead (`setup.mortalityDice: "life"`; Mars Genesis does): one die for each cause, keyed by the seed, the person and the cause and by no turn or step (`SeededRng.forLife`), and the person dies in the year their chance of having survived that cause falls to it. A run's chances of death are the same either way. With a die for life, two runs of one seed that give a person different yearly chances can record that person's death in different years, and do wherever the person's chance of having survived a cause falls to its die in a different year; where one run gives a person no higher chance of any cause in any year, that person dies no earlier in it. A progression hook gets the turn's shared stream as `ctx.rng`: a compiled hook that rolls for each person can draw differently for a later person once an earlier one has died. The Mars and Lunar hooks draw nothing from it. The same dice reach the people both colonies began with while they stay on both rosters: a person who leaves one roster only meets no die there, and a child takes its id from the turn's shared draws, so after a birth on one side only, the children born later in that turn have different ids, and so different dice, on the two sides. A person both rosters hold dies in one run and not the other only where that run's world gave them a higher chance of dying (see Mortality below). A child's name, id and traits come from the turn's own stream.

Each side of a pair runs its own model calls: its own Event Director call for every turn but the ones the scenario fixes (Mars Genesis fixes the first and the last, `milestones`), its own department reports and its own commander. An event's outcome draw and its noise term are shared, by event slot; the personality and tool terms of the outcome differ by side. The kernel applies the effects each side's choices lead to, and the states part from there. Why two leaders on one seed can lose the same people, with the live pairs of 10 November 2026 ([issue #234](https://github.com/framerslab/paracosm/issues/234) and, at about 14:10 UTC, [issue #243](https://github.com/framerslab/paracosm/issues/243)): [FAQ](FAQ.md#why-can-two-leaders-on-one-seed-lose-the-same-people).

### Mortality

Each cause has a yearly rate. A turn runs as a step for each whole year it spans, then one step for a part of a year left over; a turn shorter than a year is one step of its own length. Each step ages people, adds the physics hook's dose, moves psych and rolls every yearly chance (the deaths below, births, partnerships, friendships, recoveries, promotions) once, on dice of its own, reading the age and the dose at the step's end; in a scenario that keeps a die for life (Mars Genesis), the deaths read each person's dice for life instead (How the death dice are kept, below). A step of `f` years under one rolls `1 - (1 - rate)^f`. A turn runs at most a hundred steps (`MAX_YEAR_STEPS`), and the years past them fold into its last step, whose rates compound over them; a run's time per turn can be any number, and a century outlasts everyone the turn began with. A person takes one promotion a step. So one eight-year Mars turn gives the chances eight one-year turns give: a person aged 56 who reaches 64 in the turn has the 0.049 chance of a natural death the yearly table gives over those years, not the 0.077 of eight years at 64, and a couple can have more than one child in the turn. Twelve monthly Atlas Lab turns give the year's rate too while the rate and who it applies to hold through the year: a person aged 59.45 meets the natural rate in month seven of monthly turns, where one one-year step reads age 60.45 and applies it for the whole year. Each step then settles the colony's morale as the end of a one-year turn does: morale moves a tenth of the way to 0.6 and takes the year's pressures (a food store under six months -0.05, more people alive than the life support holds -0.08, an average psych under 0.4 -0.06 or over 0.7 +0.03; food and life support only in a run that carries them) and the step's death shock (0.04 of morale a death when more than two people die in it). The pressures are the colony's own state acting on it through the years between decisions, so they act once a year, not once for each decision: an eight-year Mars turn settles morale eight times, and the morale, psych, births and partnerships of a long turn follow what one-year turns over the same years give. A turn of a year or less is one step and settles once, however short, as it always has: Atlas Lab's months, the Digital Twin's weeks and every other turn of a year or less run as before. A step of `f` years other than one (the part of a year a long turn ends with, or the years a turn past a hundred steps folds into its last step) takes what `f` yearly settlings with the step's pressures held give: morale moves `1 - 0.9^f` of the way to `0.6 + 10 * pressures`. A leader's decisions still land once a turn, through the event outcomes and department updates above, and a change a decision makes to morale settles back through the years of the turn that follows, toward the level each year's pressures hold, `0.6 + 10 * pressures`. For a content colony (an average psych over 0.7, no food or life-support pressure) that level is 0.9, not 0.6: a turn of eight years keeps `0.9^8`, 0.43, of the distance to it, so morale 1 becomes 0.943, and two colonies 0.02 apart begin their next turn 0.009 apart. The head count is current at every step. The rates are the simulation's choices for legible stakes, not a claim about medicine.

| Cause | Yearly rate | Reads | What a leader's choices move |
|-------|-------------|-------|------------------------------|
| Natural | 1, 3, 8 and 20 percent from ages 60, 70, 80 and 90, times the supply factor | age and the colony's supply level (below the table) | the supplies the level reads, which outcomes move and a decision's adopted effects move: on Mars at most 2 habitat modules, 60 kW of power, 5 of life-support capacity, 100 litres of water a day and 200 m³ of pressurized volume a decision. A Mars turn spans eight years, so the people a run begins with age into these rates whoever leads, and the supplies set how fast they die there |
| Radiation cancer | 0.004 for each sievert of cumulative dose above 0.5, from age 30 | the dose the physics hook adds: `world.environment.surfaceRadiationMsvDay` (0.67 mSv a day when absent) times the share the habitat lets through, `0.8 ^ infrastructureModules` (each module keeps out a fifth of the dose that still reaches the colonists) | habitat modules, which outcomes build or lose and a decision's adopted effects build, at most 2 a decision on Mars. Every module lowers the dose, by less as the colony grows: 125 mSv a year at 3 modules, 80 at 5, 51 at 7, 21 at 11. A module built in a turn shields the years of the turns after it |
| Starvation | `(1 - foodMonthsReserve) * 0.15` under a month of food | `foodMonthsReserve` (each module adds 0.3 of a month a year against 0.5 eaten) | food and module effects, at most 4 months of food a decision on Mars: a store run down under a month, a disaster |
| Despair | `(0.2 - psychScore) * 0.25 * (0.5 + emotionality)` under 0.2 psych, from age 18 | psych, which morale pulls by `(morale - 0.5) * 0.2` a year (`MORALE_PULL_PER_YEAR`), beside partners (0.02 a year), outside contacts (0.01 a year), isolation (-0.04 a year) and grief; at morale 0.2 the pull outweighs a partner and contacts together, so a colony held there loses people to despair over a long run, and one held at 0.8 does not | morale effects, at most 0.15 a decision on Mars: morale pulls psych down only under 0.5, so it reaches despair only when held there for turns; a department's update, within its bound |
| Fatal fracture | `(60 - boneDensityPct) * 0.003` under 60 percent bone density, from age 40 | bone density from the physics hook | nothing: on Mars bone density stops at 90 percent of a person's baseline (94 for the Mars-born), which keeps a generated colonist above 60 |
| Accident | 0.003 times the department's weight (engineering 1.5, medical 1.2, agriculture 1.0, science 0.9, psychology 0.6, governance 0.5), from age 18, times the supply factor | department and the colony's supply level | a promotion into another department, and the supplies the level reads, as for natural deaths |

**The supply level.** A scenario marks a metric or a capacity of its `world` as a supply that sustains its people with `"sustains": true`. Mars Genesis marks five: `lifeSupportCapacity`, `waterLitersPerDay`, `powerKw`, `pressurizedVolumeM3` and `infrastructureModules`. Lunar Outpost, the deep-ocean station and the other scenarios in `scenarios/` mark none. At construction the kernel keeps what each marked supply holds on landing day, after the caller's starting resources, when it holds more than nothing (`metadata.landingSupplies`). The colony's supply level is the geometric mean, over the marked supplies the run holds as numbers, of each supply's amount against its landing-day amount; a supply at or under zero counts as a billionth of it. The supply factor is `1 / level`, held within a half and double, and each step reads it once, from that step's metrics. The natural and accident rates are multiplied by it, so a colony that holds twice its landing supplies loses its old people and has its accidents at half the rate, and one that holds half, at twice the rate. The level is 1 on landing day and stays 1 until an outcome or a decision moves a supply: a colony nobody leads, a scenario that marks no supply and a saved state that holds no landing amounts run with a factor of 1. The kernel advances at the top of each turn, so the supplies a turn ends with act on the years before the next turn, and those the last turn ends with act on none. Over 61 seeds on the turn-end metrics of the live Mars pair of 10 November 2026 ([issue #234](https://github.com/framerslab/paracosm/issues/234)), the two leaders lose different people in 58; a pair a fifth under and a fifth over landing day in one of life support, water, power or volume, and alike in everything else, in 28 (with the die for life below; [CI run 42847089724](https://github.com/framerslab/paracosm/actions/runs/42847089724/job/129937378091), on this kernel). Each person keeps the same dice under both leaders, so where one colony holds at least the other's habitat modules and supply level at every turn end, and the two are alike in everything else the death rates read (the same department heads, more than a month of food and psych above the despair range on both sides), none of the people the colonies began with, while they stay on both rosters, dies only in that colony, and on Mars Genesis none of them dies earlier there. The claim covers those people and those colonies alone. A departure on one side only takes a founder off that roster, where no die reaches them, and they can still die on the other side; a food store under a month opens starvation on its side only; morale held at 0.2 against 0.8 brings despair deaths on the low side only (`tests/engine/progression-same-dice.test.ts`); a head named into engineering takes that department's accident weight on that side only; and a child takes its id from the turn's shared draws ([`progression.ts`, line 778](https://github.com/framerslab/paracosm/blob/1e10f255584d85573175b8ca836cce31618bfebd/src/engine/core/progression.ts#L778)), so after a birth on one side only, the children born later in that turn have different ids, and so different dice, on the two sides.

What reads into no death rate: science output, Earth dependency, independence pressure, a food store above a month, and morale while psych stays above the despair range. Life support also weighs on morale when the roster outgrows it, and power pays for forged tools. The exponent (the rates divide by the level), the bounds of a half and double, the geometric mean and the five supplies Mars Genesis marks are the simulation's choices for legible stakes, like every rate in the table; none is a measured rate for a habitat.

**How the death dice are kept.** With a die a year (`setup.mortalityDice` absent or `"year"`), each step rolls a fresh die for each living person and cause against that step's chance, keyed by the seed, the turn, the step, the person and the cause. With a die for life (`"life"`, which Mars Genesis declares), each person keeps one die for each cause (`SeededRng.forLife(seed, agentId, cause)`), and `health.survival[cause]` holds their chance of having survived that cause so far: each step multiplies it by one minus the step's chance, and the person dies of the cause in the step where it falls to the die or under it. Given that a person has lived to a step, their chance of dying in it is that step's chance either way, so every rate, the order of the causes and every other roll stay as they are. Over seeds 1 to 600 a Mars colony nobody leads loses 20.52 people a run with a die for life and 20.43 with a die a year (standard error 0.11 each). With a die a year, two colonies that give a person different chances record a different death only where one of that person's yearly dice falls between the two chances in that year. With a die for life, every year's chance counts toward the person's chance of having survived, so two colonies that give a person different chances record that person's death in different years wherever that chance falls to the die in a different year. On the turn-end metrics of the six sides of the three recorded live Mars pairs, the death records (who dies, the year and the cause) differ on 61 of 61 seeds in each of the fifteen pairings of those sides, against 46 to 61 with a die a year. Who dies differs no more often: on the three live pairs, 60, 58 and 52 of 61 seeds, against 60, 57 and 54. The share of seeds on which two colonies lose different people is near `1 - e^(-n)`, n being how many people die under exactly one of the two, a run: one person a run gives 63 percent, two give 86, three give 95. So that share is a rate, read over seeds in CI (`tests/engine/mars-death-records-read-the-chances.test.ts`), and one pair of runs on one seed can still lose the same people. Lunar Outpost, the deep-ocean station, Atlas Lab and the Digital Twin keep a die a year and run byte for byte as before; a pair of one of them keeps the ties a die a year brings until its scenario declares `"life"`.

The Lunar hook adds its regolith exposure index (45 a year, or a declared surface dose) to the same dose field through a curve of its own, `1 - min(0.9, 0.2 * infrastructureModules)`, which stops at 4.5 modules. Lunar Outpost's eight one-year turns are seven years of exposure: a crew member takes 189 at its two starting modules and at most 315 with none, under the 0.5 sievert the radiation hazard starts above.

`causeHazards(agent, metrics, ageYears, years, supplyFactor)` and `turnHazard(rate, years)` in `src/engine/core/progression.ts` give these chances for one person and one step, `supplyLevel(metrics, landingSupplies)` and `supplyRateFactor(level)` give the supply factor, and `yearSteps(years)` gives the steps a turn runs as. In a run that keeps a die for life, `SeededRng.forLife(seed, agentId, cause)` in `src/engine/core/rng.ts` gives a person's one die for a cause, and `health.survival` holds their chance of having survived each cause so far.

### Morale

Every run carries `morale`, from 0 to 1. The yearly settling moves it between decisions (see Mortality above), and an event's outcome and a decision's adopted effects move it at each decision.

**A loss moves in full. A gain eases above 0.9.** A gain adds in full while it ends at or under 0.9, the level the settling holds a content colony at. The part of a gain above 0.9 closes a share of the gap left to 1, `1 - e^(-part / 0.1)`: 0.05 closes 39 percent of the gap, 0.1 closes 63 percent, 0.15 closes 78 percent, and each further 0.069 halves what is left (`moraleAfterGain` in [`progression.ts`](../src/engine/core/progression.ts), applied by the kernel's `applySystemDeltas`, where outcomes and adopted effects both land). A larger gain always ends higher, none reaches 1, and two gains land where one gain of their sum lands, so what two leaders chose stays readable in their morale. A gain that added in full up to 1 would stop there: a content colony begins an eight-year Mars turn at 0.943 at most and one decision's adopted effects alone bring up to 0.15, so morale would end most turns at exactly 1 whatever the leader chose, and the ceiling would cut what was left of every choice. The run reports the change it made: an outcome's `systemDeltas` and the `[policy] effects` line carry the eased gain, with what the effects asked beside it. The easing is the kernel's, so it holds in every scenario, and a run whose decisions never lift morale past 0.9 moves as it would without it.

**What morale reaches.** The chance an event's response succeeds (0.1 more with morale over 0.7), each person's psych (`(morale - 0.5) * 0.2` a year), partnerships (a base rate of 0.10 a year with morale over 0.35, else 0.03) and births (a base rate of 0.08 a year with morale over 0.4 and food over six months, else 0.02). The psych pull reads morale at every level; the other three read it against a level. Over six Mars turns on 61 seeds with no events, morale moved by the same amount after every turn and nothing else, a leader who loses 0.15 of morale at every turn gets the same totals of births, partnerships and deaths (941, 1273 and 1211) as one who gains 0.3 at every turn; only a loss of 0.3 at every turn changes them (889, 1271 and 1217, 6 of the deaths from despair). Events can part two leaders sooner, through the outcome chance: in that measurement the colony that loses 0.15 a turn is under 0.7 at 877 of its 2501 year starts, and a response decided while morale is under 0.7 loses the 0.1 that morale adds to its chance, so an outcome die that the other colony's chance covers can fail instead, moving the keys the failure names and, through them, who dies. So between two leaders who both keep morale over 0.7, morale is a score the verdict reads and moves no birth, partnership or outcome chance; it reaches people only through the psych pull. This is a limit of the model.

### Health Fields

Core agent health fields (`AgentHealth`):
- `alive`, `psychScore`, `conditions` are universal (every scenario)
- `boneDensityPct`, `cumulativeRadiationMsv` are optional (Mars/Lunar specific)
- `survival` holds the chance of having survived each cause of death so far, in a run whose scenario keeps one death die for a life (`setup.mortalityDice: "life"`)
- `[key: string]: unknown` index signature allows any scenario to add custom health fields

Custom scenarios define their own health metrics in their progression hooks. The kernel doesn't hard-code any domain-specific health logic.

## The Runtime

### Turn Pipeline

Before turn 1 the commander names a head for each department the run keeps active (`runDepartmentPromotions`), from the top candidates the kernel lists; a department the commander leaves open goes to its top candidate. A department counts as headed only by a living person with a promotion record, so the people a scenario's preset seeds carry specialist titles ("Senior Physician, Radiation Medicine" on Mars), never a head's title: a seeded head would sit beside the one the commander names.

Each turn follows a fixed pipeline:

```
1. Event Director generates a crisis from current colony state
   └── LLM reads: colony metrics, recent events, population health, tool history
   └── Produces: title, description, options (safe/risky), category, research keywords

2. Kernel applies between-turn progression
   └── Aging, mortality, births, career advancement
   └── Scenario-specific hooks (radiation, bone density for Mars); they read the run's metrics and environment, read only

3. Department agents analyze the crisis IN PARALLEL
   └── Each department gets: crisis context, colony snapshot, research citations, memory
   └── Each department produces: summary, risks, recommended actions, forged tools
   └── All 5 departments run concurrently via Promise.all (~30s total vs ~150s sequential)

4. Commander reads department reports and decides
   └── LLM reads: crisis, all department summaries, the options, and a decision rule:
       each option's chance of success, the outcome multipliers and the leader's
       bar for the bold option, from the profile as it stands that turn
   └── Produces: decision text, rationale, selected policies, risky/safe choice,
       and, for a choice against the bar, the fact it departs for

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

Both wrappers return the fully-validated object matching a Zod schema in [`src/runtime/validators/`](../src/runtime/validators/). Validation failures trigger up to 2 retries with the Zod error appended to the retry prompt so the model self-corrects. If retries exhaust, a caller of `sendAndValidate` that passes a `salvage` gets the newest reply it can keep (the department report keeps a reply whose one fault is effect keys the run does not hold, with those keys dropped); otherwise the wrapper returns a caller-provided fallback skeleton. Either way the run emits a `validation_fallback` SSE event so the dashboard can surface the degradation; a salvage's event carries `salvaged: true` and `droppedKeys`. The event carries no turn; the dashboard places it in the turn row of its actor's latest turn and draws it as a schema salvage card, with the keys it dropped, or a schema fallback card.

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
3. The `SandboxedToolForge` delegates to AgentOS's `CodeSandbox`, an in-process node:vm context, which applies these limits:
   - **Wall-clock timeout** enforced via `vm.runInContext` (default 10 seconds; configurable via `sandboxTimeoutMs`).
   - **Memory observed** via `process.memoryUsage().heapUsed` delta after each invocation. The default `sandboxMemoryMB: 128` is a soft monitoring target, not a hard cap; the sandbox does not preempt on overrun.
   - **`codeGeneration: { strings: false, wasm: false }`** at context construction blocks runtime `eval` and `Function()` reflection.
   - **Frozen `console`** plus explicit-undefined for `process`, `globalThis`, `require`, `setTimeout`, `setInterval`, `fetch`.
   - **Realm intrinsics blocked** at context construction: `Reflect`, `Proxy`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`. These otherwise resolve via the V8 default realm even with `codeGeneration.strings: false`.
   - **No capabilities.** paracosm's engine runs forged code under a ceiling that grants none (`capabilities: {}` in `src/runtime/orchestrator/emergent-setup.ts`), so forged code gets no `fetch`, file reads or `crypto`; a forge that asks for one is refused before the judge sees it.
4. The `EmergentJudge` (LLM-as-judge) reviews the tool for safety, correctness, determinism, and schema compliance.
5. If approved, the tool is registered at session scope and available for future turns via the `call_forged_tool` meta-tool (no re-forge required).

The run's tool ledger records each forge with its turn, department and event. A department's report writes the ledger for the forges it made; when the department's session throws after a forge the reviewers approved (a transient provider error on its next model call), its report is the empty one, and the turn loop records the approved forge itself when it takes the event's forges into the run (`recordEventForges` in [`tool-ledger.ts`](../src/runtime/orchestrator/tool-ledger.ts)). It does the same when a report recorded the tool as rejected because the department forged it again after its approval and the reviewers rejected that forge. The tool is then in the toolbox once, with that forge as its first when it had none, and counts in `forgedTools`, the verdict, `toolsForged` and the ALREADY-FORGED TOOLS block the next departments read.

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

- **Commander decisions**: the cues in the commander's first message fire at 0.7 and above and at 0.3 and below, translating trait values into concrete behavioral implications (e.g., high openness → "the unknown is opportunity, not threat"; high conscientiousness → "you would rather be slow and right than fast and wrong") ([`commander-setup.ts`, lines 55 to 83](https://github.com/framerslab/paracosm/blob/e18ce8a359e9cd11b0d89a6bf98d8d8987590a66/src/runtime/orchestrator/commander-setup.ts#L55-L83)). Every decision prompt then carries a decision rule for its event ([`buildDecisionRule`, lines 286 to 316](https://github.com/framerslab/paracosm/blob/06b4149d0b44bd3719faee70c4443e941bba4b2a/src/runtime/orchestrator/commander-setup.ts#L286-L316); built at [`orchestrator/index.ts`, lines 1567 to 1590](https://github.com/framerslab/paracosm/blob/06b4149d0b44bd3719faee70c4443e941bba4b2a/src/runtime/orchestrator/index.ts#L1567-L1590)):
  - the bold option's chance of success and the safe options', as the outcome step computes them (`outcomeSuccessChance`) for the state at that moment, in whole numbers out of 100;
  - what the event gains is multiplied by on a bold success, a bold failure, a safe success and a safe failure (2.5, -2, 1 and -1) and what it costs is multiplied by (0, 4, 1 and 3), as the effect registry applies them ([`effects.ts`, lines 18 to 28](https://github.com/framerslab/paracosm/blob/e18ce8a359e9cd11b0d89a6bf98d8d8987590a66/src/engine/registries/effects.ts#L18-L28));
  - the leader's bar: the chance at or above which this leader takes the bold option. The appetite is the mean of openness, one minus conscientiousness and one minus emotionality, read from the profile as it stands that turn; the bar is the break-even chance plus 0.8 times (0.5 minus the appetite), held within 0.1 and 0.9 ([lines 123 to 189](https://github.com/framerslab/paracosm/blob/e18ce8a359e9cd11b0d89a6bf98d8d8987590a66/src/runtime/orchestrator/commander-setup.ts#L123-L189)). The break-even chance, 4 in 7, is where the bold and a safe option gain the same on average; on what the event costs they are even at 2 in 3, and the prompt states both. The Mars presets read 36 in 100 for Aria Chen and 82 for Dietrich Voss;
  - that the department reports were written without the options (a department never sees them);
  - that the chances and multiples already include the dangers the event describes: a bold failure is that danger, its chance is stated, and its cost is counted 4 times against 3 for a safe failure, so a danger the event describes, a downside tail or the cost of failing is not a reason to depart from the bar;
  - what following the bar means (the bold option when its chance is at least the bar, a safe option when under), and that a departure names a fact these odds do not count, with its number (a supply in the State line too low to take a bold failure, or something an option needs that the colony lacks), in the reply's own `barDeparture` field. Point (4) of the reasoning asks whether the bold option's chance is at least the bar, with both numbers and a yes or no, before the choice ([`buildCommanderTurnPrompt`, lines 434 to 462](https://github.com/framerslab/paracosm/blob/06b4149d0b44bd3719faee70c4443e941bba4b2a/src/runtime/orchestrator/commander-setup.ts#L434-L462)).

  The rule states odds and a bar; it does not pick the option, and the model chooses. A leader on another trait model is shown the chances and the multipliers without a bar and is not asked for a departure.

  After the reply, the commander step checks the option chosen against the numbers its prompt stated ([`checkBarDeparture`, lines 351 to 372](https://github.com/framerslab/paracosm/blob/06b4149d0b44bd3719faee70c4443e941bba4b2a/src/runtime/orchestrator/commander-setup.ts#L351-L372); called at [`orchestrator/index.ts`, line 1645](https://github.com/framerslab/paracosm/blob/06b4149d0b44bd3719faee70c4443e941bba4b2a/src/runtime/orchestrator/index.ts#L1645)). Each record under `paracosmInternal.commanderDecisions` carries a `barCheck`: the stated chance and bar, whether the chance clears the bar, whether the choice was bold, whether it departs from the bar, the fact named, and `unexplained` for a departure that names none. A field left empty names none, and so does one that only says the bar is followed or nothing departs ("I follow my bar", "No departure") or puts a placeholder before punctuation ("None, I follow my bar"); a field that opens with a placeholder word and goes on to a fact ("None of the 39 colonists ...") keeps it. `paracosmInternal.barChecks` counts the run's checked decisions, the ones that followed the bar, the departures, and the departures with no fact named ([`summarizeBarChecks`, lines 387 to 395](https://github.com/framerslab/paracosm/blob/06b4149d0b44bd3719faee70c4443e941bba4b2a/src/runtime/orchestrator/commander-setup.ts#L387-L395); [`orchestrator/index.ts`, line 2096](https://github.com/framerslab/paracosm/blob/06b4149d0b44bd3719faee70c4443e941bba4b2a/src/runtime/orchestrator/index.ts#L2096)). A departure with no fact stands as the commander's choice and writes one log line; it is not retried, since a retry could check only that the field is filled. The departure line read "Depart from it only for a reason that belongs to this event" until [issue #250](https://github.com/framerslab/paracosm/issues/250): on the first live pair with the rule (11 November 2026, version 0.9.1101), Aria Chen stated that the bold option's chance cleared her bar on all 6 of her events and chose a safe option on 5, each time for a danger the event described.
- **Colonist reactions**: per-agent reaction blocks include cue strings from `buildReactionCues` so reacting agents don't have to re-derive personality behavior from a vector each call. All six axes have both-pole cues.
- **Personality drift**: all six traits drift turn-over-turn from experience. Three forces combine per trait:
  - *Leader pull*: trait value converges toward the commander's (Van Iddekinge 2023)
  - *Role pull*: department role activates specific traits (Tett & Burnett 2003)
  - *Outcome pull*: every (trait, outcome) pair has a peer-reviewed sign (Silvia & Sanders 2010 for openness; Roberts et al. 2006 for conscientiousness; Smillie et al. 2012 for extraversion; Graziano et al. 2007 for agreeableness; Lee & Ashton 2004 for emotionality; Hilbig & Zettler 2009 for honesty-humility)
  - A head's pull is capped at ±0.05 a time unit and then scaled by the turn's length ([`progression.ts`, line 111](https://github.com/framerslab/paracosm/blob/e18ce8a359e9cd11b0d89a6bf98d8d8987590a66/src/engine/core/progression.ts#L111)), so one Mars turn of 8 years can move a head's trait by up to 0.4; bounds [0.05, 0.95]
- **Commander drift**: the commander's HEXACO evolves alongside agents. The runtime clones `actor.hexaco` at run start and applies outcome-pull after every turn's resolution. The pull is scaled by the turn's length and then capped at ±0.05, so one turn moves a leader's trait at most 0.05 however long the turn; bounds [0.05, 0.95] ([`progression.ts`, lines 137 to 152](https://github.com/framerslab/paracosm/blob/e18ce8a359e9cd11b0d89a6bf98d8d8987590a66/src/engine/core/progression.ts#L137-L152); the trait-model path, [`drift.ts`, line 170](https://github.com/framerslab/paracosm/blob/e18ce8a359e9cd11b0d89a6bf98d8d8987590a66/src/engine/traits/drift.ts#L170)). The final output carries both the drifted `hexaco`, the original `hexacoBaseline`, and a per-turn `hexacoHistory` for trajectory visualization. The caller's `ActorConfig` is never mutated.
- **Trajectory cues**: commander, director, and department-head prompts all receive a one-line cue describing drift since turn 0 ("Since you took command, your personality has drifted substantially toward higher openness and measurably away from higher conscientiousness. Notice how recent decisions have shaped your judgment."). Threshold 0.05 matches the leader's per-turn cap.
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

The Event Director generates different crises for each commander based on their colony's current state, except on the turns the scenario fixes. Same seed controls the deterministic kernel, but the LLM-generated crises diverge based on accumulated state differences.

Every director call carries the rules on how an event's bold and safe options differ ([`OPTION_TRADEOFF_RULES`, `director.ts` lines 131 to 159](https://github.com/framerslab/paracosm/blob/e18ce8a359e9cd11b0d89a6bf98d8d8987590a66/src/runtime/orchestrator/director.ts#L131-L159)): the two differ in size, scope, time horizon and commitment; the bold option is neither obviously stupid nor obviously correct; it is a bet on a larger gain, never the omission of a safety step, a bypass or a shortcut past a check; any option id may hold it; and no label carries the words risky, safe, conservative or bypass. A scenario's own director instructions are sent with the rules after them ([`directorSystemInstructions`, lines 278 to 283](https://github.com/framerslab/paracosm/blob/e18ce8a359e9cd11b0d89a6bf98d8d8987590a66/src/runtime/orchestrator/director.ts#L278-L283)); six bundled scenarios carry their own (Atlas Lab, Corporate Quarterly, the dual superintelligence council, Lunar Outpost, Mars Genesis and the submarine). The director's state lines print each metric in the unit the scenario declares, as the commander's state line does, so full morale reads 100%.

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
| **SSE stream** | `systems_snapshot` event fires every turn with the full agent roster + per-turn births/deaths/morale, and the food reserve in a run that carries `foodMonthsReserve`. |

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

After a pair run completes all turns, an LLM compares the two leaders' final states and produces a verdict ([`judgePair`](../src/cli/pair-runner.ts)). A cohort run of up to 50 leaders gets a ranked `cohort_verdict` instead ([`judgeCohort`](../src/cli/pair-runner.ts)); past 50 the verdict is skipped and the dashboard shows group-median deltas and the constellation view.

Both judges weigh the scores the scenario declares, not a fixed colony list. [`verdict-scores.ts`](../src/cli/verdict-scores.ts) reads every entry of the scenario's `metrics` (the `ui.headerMetrics` ones first) from each run's final state and puts them side by side, with each score's label, format and unit; a metric whose world field has unit `frac` reads as a percentage, and a percent score held on a 0 to 100 scale (Submarine's Hull Integrity) is brought to the same scale. A metric with no `source` (a seed-compiled draft declares only `id` and `format`) reads `metrics.<id>`. A score no run holds a value for is left out; where none remain, the final state's numeric metrics stand in. A metric that sets `better: "lower"` (Atlas Lab's Spec Gaming Rate, T2D's HbA1c) is marked so, and the card and the scoreboard colour the lower side as the leader; a metric that does not set it is treated as better higher on those two screens. The status and politics fields the scenario declares are added where the runs differ, and the prompt uses the scenario's own words (`labels.name`, `settlementNoun`, `populationNoun`, `actorNounPlural`, `tagline`). The judge is told that a lead on most of the scores is a win and that a tie is only for runs whose scores are the same.

```text
ATLAS LAB SCORES (each run's final value, A | B)
  Researchers: A 34 | B 32
  AlignmentBench: A 0.80 | B 0.87
  Spec Gaming Rate: A 4.2% | B 2.2% (lower is better)
  Capability Index: A 0.84 | B 0.84
  Release Readiness: A 62% | B 76%
  Red-team Coverage: A 59% | B 64%
  Monthly Burn (USD/mo): A 12111557 | B 12123221 (lower is better)
  Runway (months): A 18.7 | B 18.8
```

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

Below the scores, each run gets a summary read from its RunArtifact: the mortality line counts the `death` events in `scenarioExtensions.paracosmInternal.finalState.eventLog`, which progression writes when it kills an agent (a department's patch cannot mark an agent dead); the innovation line gives the number of `forgedTools` entries the reviewers approved and the length of `citations` (an empty list is dropped from the artifact, so a run that forged nothing answers from `paracosmInternal.totalToolsForged` and `totalCitations`; a forge attempt rejected on every try stays in `forgedTools` with `approved: false` and counts for nothing here, also when a department cites the tool later without forging it, and the departments are not offered it for reuse); the top tools are the five most reused, with `firstForgedDepartment` and `reuseCount`, and entries with no `reuseCount` are listed in order under `Tools (reuse not recorded in this run)`; a tool's name and department reach the prompt on one line and cut at 120 characters; the cost line reads `cost.totalUSD` and `cost.llmCalls`. A line the artifact cannot fill reads `not recorded in this run`, never a zero. The fingerprint a run carries counts each approved tool once, however often it was used, so its `totalTools` equals the innovation line's count, and so do the `toolsForged` that `turn_done` and `sim_aborted` carry on the stream (the tools so far) and the director prompt's "Tools forged so far".

The verdict is broadcast as an SSE `verdict` event and rendered in the dashboard as a comparison card with score bars. Its `finalStats` carries the colony fields and the run's forged-tool count (`a`, `b`) and `metrics`, the scenario's header scores (every score when the scenario names no header) with both leaders' values, percent scores as fractions; the card and the report scoreboard list `metrics` when it is present, under the scenario's settlement word (`settlementNoun`). A value a run does not hold reads n/a and names no leader. A failed verdict call broadcasts `verdict_skipped` and the run still reaches `complete`.

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

**Demo runtime** (the dashboard server: one run per visitor, ephemeral state)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/scenario` | The caller's scenario: the one `?id=` names (404 when the catalog has no such id), else the visitor's pick (the `paracosm_scenario` cookie), else the server's default, Mars Genesis. Labels, setup, departments, presets (with `leaders`) and `ui`. Each `ui.headerMetrics` entry carries its world field's `max` and numeric `initial` where the field declares them, so a percent metric held on 0 to 1 reads the same as one held on 0 to 100. A pick still compiling after a restart answers 503 with `Retry-After: 5`. The dashboard's Run controls stay disabled until this answers 200 |
| `GET` | `/scenarios` | The scenario catalog, with `active` the visitor's pick or the default |
| `POST` | `/scenario/switch` | `{ "id": "<scenario id>" }`: checks the id against the catalog (400 for an unknown id or a stored draft that is not runnable) and answers `{ active, name }` with the `paracosm_scenario` cookie, which holds that id for 30 days. Changes nothing for other visitors |
| `POST` | `/setup` | Start a new simulation with leaders, turns, seed, departments. The run is the caller's: it replaces the caller's own run (one in flight is stopped first), answers `runKey` (its `active_scenario` event's) and `visitorId`, and answers 503 with `Retry-After: 180` and `{ error, runsInFlight, maxRuns }` while the server has its most runs in flight (`PARACOSM_MAX_RUNS`, 3), before the day's run is counted. The run's scenario is the body's `scenarioId` (or `quickstart.scenarioId`, or a fork's parent's), else the visitor's pick, else the default; a named id the catalog lacks answers 400, and one still compiling after a restart 503, before the daily run limit counts the request. A run in a scenario that is not the visitor's pick answers with the `paracosm_scenario` cookie for that scenario, so the `/sim` page the dashboard opens next shows the run. A setup value the body omits (start time, time per turn, population, seed, turns, key personnel) comes from the run's scenario, an omitted population being at least one person per department; a fork's omitted start time and time per turn come from its parent's snapshots, a fork with no turn left answers 400; a parent snapshot at a turn that is not whole or is above 10,000 gives no timeline |
| `GET` | `/events` | SSE stream of the caller's run (`systems_snapshot` carries the swarm), the runs they start next included; `?run=<key>` follows one run instead (404 for a key the server does not hold). The `connected` frame names the stream's `runKey` and `visitorId` |
| `POST` | `/clear` | Drop the caller's own run, stopping it when in flight, and its chat agents; the run's other viewers get `run_cleared`. An optional `{ "runKey" }` names the run the page held: another key of the caller's answers `{ cleared: false, reason: 'not_current' }`, another visitor's 403 |
| `POST` | `/chat` | Chat with a colonist agent of the caller's run, as the colonist lived under the body's `leader` (else the first leader under whom they reacted) |
| `GET` | `/results` | Full simulation results including verdict, of the caller's run or the one `?run=<key>` names, with `runKey`, `scenarioId` and `inFlight` |
| `GET` | `/rate-limit` | Check rate limit status |
| `POST` | `/compile` | Compile a custom scenario draft with optional `seedText` / `seedUrl` grounding |
| `GET` | `/retry-stats` | Cross-run reliability rollup (schemas + forges + caches + providerErrors) over the last N completed runs. Query param: `?limit=N` |

The scenario pick is a first-party cookie, `paracosm_scenario` (`Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`, plus `Secure` on the hosted demo), that holds only the scenario's id. `/scenario/switch` sets it, and so does a `/setup` run in a scenario other than the pick; two tabs of one browser share it. A browser sends it on same-origin requests alone, so a cross-origin caller under the server's `Access-Control-Allow-Origin: *` names its scenario in the `/setup` body or with `?id=`. `GET /scenario` and `GET /scenarios` answer `Cache-Control: no-store` and `Vary: Cookie`.

Each visitor's run is their own. The dashboard's HTML (`GET /sim`, answered `Cache-Control: no-store`) gives a browser the `paracosm_visitor` cookie once: a random id, kept 30 days, that identifies the browser to this server and nothing else. A run's event buffer, its stream, its disconnect watchdog and its flags belong to its visitor, so a reload and a second tab of the browser find the run, and no other visitor's page shows it, stops it or clears it. A visitor has one run at a time, and their next run replaces it. The server has at most `PARACOSM_MAX_RUNS` runs in flight at once, every visitor's together (3 by default); a visitor above that is answered 503, with words their launch shows: "The server is running 3 simulations right now, the most it runs at once. Try again in a few minutes." A run holds its place until its runner settles, a run its visitor replaced or cleared included, since its last model call is still out; the visitor's next run alone is let in beside the run it replaces or the run their Clear stopped right before it. A Digital Twin run holds its place until its engine returns, whoever replaced it, since nothing stops the engine. A caller that sends no cookie (the CLI's own run, curl, a script) is the anonymous visitor, one visitor for every such caller, with the server's single-run behaviour; a visitor with no run of their own watches the anonymous visitor's run, so the browser that opens the CLI's dashboard sees the CLI's run, until they start one. A stream that has followed a run of its visitor's own keeps to that visitor's runs: when their run goes, it shows nothing of the anonymous run until it reconnects. The hosted demo shares no anonymous run: there a cookieless caller's run shows on no visitor's page. A Clear in one tab sends `run_cleared` to the visitor's other tabs, which empty their view. The disconnect watchdog is per run: it stops a run in flight 10 minutes after its last viewer leaves, and never a run nobody watched. A finished run is held for its visitor until they replace or clear it, until nobody has read or watched it for 30 minutes, or until the held runs go over `PARACOSM_MAX_HELD_RUNS` (10) or `PARACOSM_MAX_HELD_RUN_BYTES` (64 MiB), the oldest first; `${APP_DIR}/.live-runs/` holds them across a restart, and a run the restart cut comes back ended, its `sim_aborted` reason `server_restarted`. One limit is open ([#211](https://github.com/framerslab/paracosm/issues/211)): a browser that opens two dashboard tabs before it holds the cookie gets an id from each tab's `GET /sim` answer and keeps the one that came last. A run the first tab starts in the time between the two answers is the first id's, so when that tab next connects (a reload, a dropped connection, or the reopen after a launch answered for another id) its stream follows the browser's id and no longer shows the run; a Digital Twin run started from that tab opens under the browser's id while its open stream is the old id's, so its progress view shows nothing until the run's answer arrives. The window closes once both tabs hold the same cookie.

Every run opens its buffer with an `active_scenario` event naming its scenario and its `kind` (`pair`, `batch`, `fork` or `intervention`), and the dashboard shows the run only when that scenario is the page's own, so a page on another scenario comes up without it; a run loaded from a file is not the feed's, and stays when the page learns its scenario. The event also carries a `runKey` of its own: a reconnect replays the same key, so the page keeps what it holds, and a new key in the page's scenario is a new run, which the page shows on its own. A fork's event names its parent run and turn (`forkedFrom`, null on every other run), and the page that forked keeps the run it holds and shows the fork as a branch of it. A page that was showing a run in progress when its own visitor started another run in another scenario shows its run as interrupted.

A Digital Twin run (`POST /api/quickstart/simulate-intervention`) writes the frames a `/setup` run writes: `active_scenario`, one `status` with the turn count and the leader, each engine event as a `sim` event tagged with its leader, and `complete` (with `sim_error` before it, and `aborted: true`, when the run fails). Unless the body names a `scenarioId` the run is in `t2d-glp1-protocol`, which no page can pick, so the page that starts it mints a `runKey`, names it in the body, and the server opens the run with that key; a key a run has already opened with is refused with a 409. That page shows the run with its key in the Digital Twin progress view and the result's playback whichever scenario the page is on; its other views and its history leave the run out. A Digital Twin run is its caller's run, as a `/setup` run is: it replaces their run (one in flight is stopped), leaves every other visitor's alone, and counts toward the run cap until the engine returns. The page posts `/clear` naming the run it held before it starts the twin, so a `/clear` that lands late leaves the twin alone. A run the visitor starts during a Digital Twin run replaces it: the twin writes nothing more to its stream, and the twin's answer still carries its artifact. When that run is in the page's scenario the page shows it as any run, and the Digital Twin views keep the twin's events as they stood. A run the page starts itself replaces the Digital Twin views on the SIM tab, during the twin's run or after it, once the server has taken it from one of the page's Run controls (a run the server refuses, such as one over the day's limit or above the run cap, leaves the views, the twin's events in its progress view and playback, and its answer as they were) or as soon as a Quickstart launch begins. A run loaded from a file or from the page's history, and a clear of the page's local data, replace the views too. The page drops the answer, or the failure, of a twin it has left when it comes back later, on the SIM tab and on the Quickstart tab. A Digital Twin run is not saved as a session: its artifact comes back in that answer.

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

Every Zod-validated LLM call site reports `{ attempts, calls, fallbacks }` to the run-scoped cost tracker, and `salvaged` once a call's result was kept from a reply that failed its schema (a department report with its unheld effect keys dropped); `/retry-stats` sums it where a run has it. Every forge attempt reports `{ approved, confidence, name, errorReason }`. Every LLM call that throws gets classified by the provider-error classifier. Every cache hit/write on supported providers increments the cache tracker. On run completion the server snapshots the per-run rollup into a rotating ring of the last 100 runs (`.retry-stats.json` on disk).

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
3. After `compile_done`, the scenario is added to `customScenarioCatalog`, and the page that compiled it switches to it; the pick is that visitor's. The Sim tab will run it on the next RUN click.

Common mistake: clicking **Store** (saves the JSON draft, does not generate hooks) and then hitting RUN. The run proceeds with whichever scenario the page had picked (Mars by default): the editor still shows Mercury, the page title pulls the label from the stored JSON, but the simulation runs Mars. Fix: click Compile, not Store.

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
console.log(replay.matches);     // true when the between-turn step reproduces each saved snapshot
console.log(replay.divergence);  // empty when matches=true; JSON pointer otherwise
```

`replay()` restores the kernel from each recorded snapshot, runs `advanceTurn` to the next snapshot's turn, and compares the fresh snapshots to the input via canonical JSON. Cost: zero LLM. Wall-clock: dominated by JSON parse plus per-turn kernel state advancement. `matches=true` shows the between-turn step reproduces each recorded transition. What a match proves and what it does not, in plain words: [FAQ](FAQ.md#what-does-replay-do).

Required preconditions on the input artifact:

- `scenarioExtensions.kernelSnapshotsPerTurn` populated (parent created with `captureSnapshots: true`).
- `decisions[]` populated.

Throws `WorldModelReplayError` when either is missing or when the artifact's scenario id does not match the WorldModel's scenario.

Scope note: v1 replay re-runs `advanceTurn` only. Re-applying recorded decisions via `kernel.applyPolicy` is a follow-up once the public RunArtifact preserves enough department-report context for `decisionToPolicy` to reconstruct PolicyEffects faithfully. The turn loop records each snapshot at the end of its turn, after the turn's policy effects, outcome effects, drift and reactions, so a run the turn loop saved reports a mismatch at its second snapshot; [#235](https://github.com/framerslab/paracosm/issues/235) tracks it. A run with one snapshot matches with no transition checked, since replay copies its only snapshot.

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
| `SystemContentBlock` w/ `cacheBreakpoint` | Stable system prefixes cached at 0.1× cost across turns (director instructions, dept system prompt). The reaction batch prompt is not marked: what its batches share is far below the provider's cache minimum (4,096 tokens on Claude Haiku 4.5) |
| `EmergentCapabilityEngine` | Runtime tool forging in an in-process node:vm context |
| `EmergentJudge` | LLM-as-judge safety review of forged tools |
| `AgentMemory.sqlite()` | Colonist chat memory with episodic storage and RAG; each run's research memory |
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
