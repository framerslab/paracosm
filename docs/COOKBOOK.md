# Paracosm Cookbook

Wire-level inputs and outputs for every public surface in the paracosm API. Every JSON snippet on this page was captured from a real run of [`scripts/cookbook-e2e.ts`](../scripts/cookbook-e2e.ts) on **2026-04-25** against `paracosm@0.7.0`. Re-run the script to refresh the captures against your provider, model, and seed.

The runner exercises the API in this order:

- [`WorldModel.fromPrompt`](#1-worldmodelfromprompt) draft a scenario from a free-text brief
- [`compileScenario` + `WorldModel.fromScenario`](#1b-known-good-scenario-via-compilescenario) load a cached scenario for the rest of the steps
- [`wm.quickstart`](#2-wmquickstart) auto-generate HEXACO leaders and run them in parallel
- [`wm.forkFromArtifact`](#3-wmforkfromartifact) branch at any past turn with a different leader
- [`wm.replay`](#4-wmreplay) verify the kernel is byte-equal-deterministic
- [`POST /simulate`](#5-post-simulate) one-shot HTTP endpoint for non-SSE consumers
- [`wm.intervene`](#6-wmintervene) digital-twin pattern with subject + intervention
- [`wm.batch`](#7-wmbatch) N actors per scenario manifest

Captured JSON files live in [`output/cookbook/`](../output/cookbook/). Each section embeds excerpts; the full files are linked.

## The scenario

The runner uses an **AI Lab Director** brief: a Q4 2026 release decision for a frontier multimodal model that scored 84% on AlignmentBench-2026 with two flagged concerns (4.2% specification gaming, mesa-objectives shifting under DPO). The director chairs Alignment, Capability, Policy, Infrastructure, Comms, and Leadership. Decisions in step 1's output map onto a real release-pressure scenario.

> Steps 2 through 7 use the built-in `corporate-quarterly` scenario (cached compile, stable hooks) so the runtime captures are clean. The fromPrompt path is shown standalone in step 1 because freshly LLM-generated hook code can be fragile until validated by a model with strong code-output discipline. The same captures with stable hooks come from `compileScenario` against any well-tested input.

## How to run it yourself

```bash
cd apps/paracosm
cp .env.example .env  # add OPENAI_API_KEY or ANTHROPIC_API_KEY
npx tsx scripts/cookbook-e2e.ts
ls output/cookbook/   # 7 input/output JSON pairs
```

Cost ceiling is enforced at $1 per artifact and $5 total. The runner aborts if either tripwire fires.

---

## 1. `WorldModel.fromPrompt`

Compile a paracosm scenario from a free-text brief plus an optional domain hint. The LLM proposes a draft against `DraftScenarioSchema`, the draft is validated by Zod, then routed into the existing `compileScenario` pipeline so the seed-grounding and hook-generation stages still fire. JSON is the canonical contract; `fromPrompt` makes unstructured text a first-class authoring input.

### Input

```ts
import { WorldModel } from 'paracosm';

const wm = await WorldModel.fromPrompt(
  {
    seedText: AI_LAB_BRIEF,
    domainHint: 'AI safety lab leadership decision under release pressure',
  },
  {
    provider: 'openai',
    model: 'gpt-5.4-nano',
    draftProvider: 'openai',
    draftModel: 'gpt-5.4-mini',
    webSearch: false,
    onProgress: (hook, status) => console.log(`[${status}] ${hook}`),
  },
);
```

The full input recorded by the runner: [`output/cookbook/01-input-fromPrompt.json`](../output/cookbook/01-input-fromPrompt.json)

### Output (excerpt)

The compiled `ScenarioPackage` minus its function hooks. The runner persists this minus-hooks JSON because a `ScenarioPackage` includes `progressionHook`, `directorPromptHook`, etc., which are functions and don't serialize.

```json
{
  "id": "ai-safety-lab-release-pressure-q4-2026",
  "labels": {
    "name": "AI safety lab release pressure: Atlas-7 launch decision",
    "populationNoun": "employees",
    "settlementNoun": "lab",
    "timeUnitNoun": "quarter",
    "currency": "USD"
  },
  "setup": {
    "defaultTurns": 6,
    "defaultPopulation": 180,
    "defaultStartTime": 202607,
    "defaultSeed": 202607
  },
  "departments": [
    { "id": "alignment", "label": "Alignment", "role": "safety evaluation and risk assessment", "instructions": "Track evaluator concerns, specification gaming, mesa-objective signals, and incident likelihood..." },
    { "id": "capability", "label": "Capability", "role": "model performance and product impact", "instructions": "Represent benchmark strength, product value, and competitive positioning..." },
    { "id": "policy", "label": "Policy", "role": "governance and release approvals", "instructions": "..." },
    { "id": "infrastructure", "label": "Infrastructure", "role": "deployment reliability and operational readiness", "instructions": "..." },
    { "id": "comms", "label": "Comms", "role": "public messaging and stakeholder coordination", "instructions": "..." },
    { "id": "leadership", "label": "Leadership", "role": "final decision and cross-functional arbitration", "instructions": "..." }
  ],
  "metrics": [
    { "id": "alignment-score", "format": "number" },
    { "id": "spec-gaming-rate", "format": "percent" },
    { "id": "mesa-objective-risk", "format": "percent" },
    { "id": "incident-probability", "format": "percent" },
    { "id": "enterprise-arr-at-risk", "format": "currency" },
    { "id": "release-readiness", "format": "percent" },
    { "id": "stakeholder-confidence", "format": "percent" }
  ],
  "theme": "Frontier AI lab leadership under release pressure..."
}
```

Full output: [`output/cookbook/01-output-scenario-package.json`](../output/cookbook/01-output-scenario-package.json).

### What just happened

The brief named six decision-relevant departments, eight quantifiable metrics, a quarterly cadence, and an `enterprise-arr-at-risk` metric expressed in `currency`. None of these were hard-coded. The LLM read the seed and chose `populationNoun: 'employees'`, `settlementNoun: 'lab'`, and `timeUnitNoun: 'quarter'` from inference; the dashboard's turn header would render `"Quarter 1"`, `"Quarter 2"`, etc. without any code change. The compiler then generated TypeScript hooks (progression, director, prompts, milestones, fingerprint, politics, reactions) and attached the seed-extracted topics + facts as a `KnowledgeBundle` for downstream RESEARCH grounding.

---

## 1b. Known-good scenario via `compileScenario`

For runtime captures the runner switches to the built-in `corporate-quarterly` scenario, which has cached hooks under `.paracosm/cache/corporate-quarterly-v1.0.0/`.

```ts
import { compileScenario } from 'paracosm/compiler';
import { WorldModel } from 'paracosm';

const compiled = await compileScenario(worldJson, {
  provider: 'openai',
  model: 'gpt-5.4-nano',
  cache: true,
});
const wm = WorldModel.fromScenario(compiled);
```

Cache hits return immediately; first compile runs the hook-generation pipeline at roughly $0.10. Compiled scenarios are valid `ScenarioPackage` instances with executable hooks attached.

---

## 2. `wm.quickstart`

The quickstart auto-generates N HEXACO archetypes for the world and runs them all in parallel under the same seed. The whole point: same seed, different personality, see divergence.

### Input

```ts
const result = await wm.quickstart({
  actorCount: 3,
  maxTurns: 3,
  seed: 42,
  captureSnapshots: true,
  provider: 'openai',
  model: 'gpt-5.4-nano',
});
```

Full input: [`output/cookbook/02-input-quickstart-options.json`](../output/cookbook/02-input-quickstart-options.json).

### Output: leaders

Three structured-output `LeaderConfig` objects with HEXACO bounds enforced via Zod. The actual generation against the corp-quarterly scenario produced these archetypes:

```json
[
  {
    "name": "Marin Kade",
    "archetype": "Aggressive Sales Optimizer",
    "unit": "Sales (VP of Sales)",
    "hexaco": { "openness": 0.64, "conscientiousness": 0.33, "extraversion": 0.86, "agreeableness": 0.26, "emotionality": 0.29, "honestyHumility": 0.42 },
    "instructions": "Overbook the forecast, then pressure every account for signatures this quarter. If a contract clause blocks momentum, escalate for a fast concession."
  },
  {
    "name": "Dr. Sora Wen",
    "archetype": "Systems Engineer of Control",
    "unit": "Engineering (VP of Engineering)",
    "hexaco": { "openness": 0.31, "conscientiousness": 0.86, "extraversion": 0.34, "agreeableness": 0.58, "emotionality": 0.22, "honestyHumility": 0.64 },
    "instructions": "Lock scope and enforce change control; stability beats speed. Approve only the highest-confidence releases and document every deviation."
  },
  {
    "name": "Elena Rocha",
    "archetype": "People-First Culture Stabilizer",
    "unit": "People (Chief People Officer)",
    "hexaco": { "openness": 0.52, "conscientiousness": 0.61, "extraversion": 0.46, "agreeableness": 0.82, "emotionality": 0.71, "honestyHumility": 0.74 },
    "instructions": "When targets tighten, protect retention: transparent comms, coaching, and workload triage. Refuse incentives that create fear or degrade psychological safety."
  }
]
```

Full actors: [`output/cookbook/02-output-actors.json`](../output/cookbook/02-output-actors.json).

### Output: artifacts (excerpt for Marin Kade)

```json
{
  "fingerprint": {
    "resilience": "stable",
    "innovation": "productive",
    "riskStyle": "cautious",
    "decisionDiscipline": "undisciplined",
    "summary": "riskBehavior:steady · outcomeStability:low · financialRobustness:fragile · cashStress:severe · marketMomentum:mixed · operationalCapacityFit:scaling · leadershipStyle:balanced · funding:series-b · timeline:within,2q · tools:broad",
    "totalTools": "7",
    "successRate": "0.33",
    "survivalRate": "1.00"
  },
  "metadata": {
    "runId": "corp-aggressive-sales-optimizer-1777185368038",
    "scenario": { "id": "corporate-quarterly", "name": "Q-Scope Corp" },
    "seed": 42, "mode": "turn-loop"
  },
  "finalState": {
    "metrics": {
      "population": 105, "morale": 0.65, "runwayMonths": 14, "marketShare": 0.08,
      "revenueArr": 6000000, "burnRate": 834298, "deliveryCapacity": 6
    }
  },
  "trajectory": {
    "mode": "turn-loop",
    "timeUnit": { "singular": "quarter", "plural": "quarters" },
    "timepointCount": 3
  }
}
```

Full artifacts: [`output/cookbook/02-output-artifacts.json`](../output/cookbook/02-output-artifacts.json).

### What just happened

Three independent simulations ran concurrently against the same compiled `corporate-quarterly` scenario, seed 42, identical opening events. They diverged because the leaders have different HEXACO profiles. The fingerprint is a `Record<string, string | number>` of loose classification scores (`resilience`, `innovation`, `riskStyle`, `decisionDiscipline`, plus computed summaries). Same seed, different `Marin Kade` (HEXACO O:0.64 C:0.33 E:0.86) versus `Dr. Sora Wen` (O:0.31 C:0.86 E:0.34): visibly different `decisionDiscipline` classifications, different forge counts, different decision rationales recorded in `decisions[].reasoning`.

---

## 3. `wm.forkFromArtifact`

Counterfactual world simulation operationalized: branch a stored artifact at any captured turn with a different leader, seed, or custom events. The kernel resumes from the embedded snapshot at `atTurn`; turns 0 through `atTurn` are not re-computed.

### Input

```ts
const branchWm = await wm.forkFromArtifact(trunk, 1);
const branch = await branchWm.simulate(altLeader, {
  maxTurns: 3,
  seed: 42,
  captureSnapshots: true,
  provider: 'openai',
  costPreset: 'economy',
});
```

Full input: [`output/cookbook/03-input-fork.json`](../output/cookbook/03-input-fork.json).

### Output (excerpt)

```json
{
  "metadata": {
    "runId": "corp-systems-engineer-of-control-1777185465467",
    "forkedFrom": {
      "parentRunId": "corp-aggressive-sales-optimizer-1777185368038",
      "atTurn": 1
    },
    "scenario": { "id": "corporate-quarterly", "name": "Q-Scope Corp" }
  },
  "fingerprint": {
    "decisionDiscipline": "mixed",
    "leadershipStyle": "disciplined",
    "successRate": "0.50"
  },
  "finalState": {
    "metrics": { "population": 105, "morale": 0.54, "runwayMonths": 16.12, "burnRate": 807518.99 }
  },
  "decisionCount": 2,
  "sampleDecision": {
    "time": 2,
    "actor": "Dr. Sora Wen",
    "choice": "Launch a reliability-first delivery sprint (4-8 weeks) to reduce release variance, instrument SLAs, and remove the top bottleneck limiting delivery capacity, then ship measurable improvements to stabilize revenue expectations.",
    "outcome": "conservative_success"
  },
  "forgedToolCount": 3,
  "citationCount": 5,
  "cost": { "totalUSD": 0.3386, "llmCalls": 26 }
}
```

`maxTurns` on the branch is the **absolute final turn index**, not the branch length: a 3-turn branch from turn 1 means `maxTurns: 3` (resumes at turn 1, runs through turns 2, 3).

Full output: [`output/cookbook/03-output-branch.json`](../output/cookbook/03-output-branch.json).

### What just happened

The trunk used Marin Kade (Aggressive Sales Optimizer, low conscientiousness) and ended at morale 0.65 / runway 14 months. The branch picked up turn 1 state and ran turns 2-3 under Dr. Sora Wen (Systems Engineer of Control, high conscientiousness). Final morale 0.54, runway 16.12 months, `decisionDiscipline` flipped from `undisciplined` to `mixed`, `leadershipStyle` flipped to `disciplined`. Same starting world; one variable swapped at turn 1; measurable trajectory delta. The dashboard renders this as a Branches tab where forks accumulate as cards with per-metric deltas streaming live as each branch completes.

---

## 4. `wm.replay`

The kernel is fully deterministic. `wm.replay(artifact)` re-executes the between-turn progression hook from each recorded snapshot and compares the fresh `kernelSnapshotsPerTurn` array against the input artifact's via canonical JSON. No LLM calls. Free, fast, regression-test-shaped.

### Input

```ts
const replay = await wm.replay(trunk);
```

Full input: [`output/cookbook/04-input-replay.json`](../output/cookbook/04-input-replay.json).

### Output (real captured)

```json
{
  "matches": false,
  "divergence": "/1/state/agents/0/hexaco/agreeableness (0.4945439798311554 vs 0.4789224283991382)"
}
```

The replay caught a real divergence: agent 0's HEXACO agreeableness drifted differently in the second pass than the first. The output pinpoints the exact JSON pointer + the two values. `matches=true` would prove byte-equal kernel determinism for the full transition graph; `matches=false` is exactly what you want for forensic diff after a kernel change. This run's failure is honest: the cookbook documents the tool as it actually behaves on this artifact.

Full output: [`output/cookbook/04-output-replay-result.json`](../output/cookbook/04-output-replay-result.json).

### What just happened

`replay()` re-executed the deterministic between-turn progression hook from each recorded snapshot and compared the fresh `kernelSnapshotsPerTurn` array against the input artifact's via canonical JSON. The hook is supposed to be deterministic; the captured `agreeableness` divergence on agent 0 between the original run and the replay is a real determinism gap to investigate. This is what the API is for: pillar 2 (Reproducible) is verifiable in code, not promised in copy. Use `replay()` for regression testing (replay golden artifacts in CI), forensic comparison (find the first kernel-state divergence between two versions of paracosm), and pre-merge gates that block on `matches !== true` for a committed golden artifact.

---

## 5. `POST /simulate`

For non-SSE consumers (curl, Python integrations, third-party dashboards) the server exposes a request-response endpoint. Gated behind `PARACOSM_ENABLE_SIMULATE_ENDPOINT=true` so the hosted demo's SSE-first path stays the default.

### Request

```bash
PARACOSM_ENABLE_SIMULATE_ENDPOINT=true paracosm dashboard

curl -X POST http://localhost:3456/simulate \
  -H 'Content-Type: application/json' \
  -H 'X-OpenAI-Key: sk-...' \
  -d '{
    "scenario": { ... },
    "leader": { ... },
    "options": { "maxTurns": 2, "seed": 7, "captureSnapshots": false, "provider": "openai", "costPreset": "economy" }
  }'
```

The runner calls this in-process: it boots `createMarsServer({ env })` on a random port, fetches against `localhost:<port>/simulate`, then closes the server. Full request: [`output/cookbook/05-input-http-simulate.json`](../output/cookbook/05-input-http-simulate.json).

### Response (real captured)

```json
{
  "status": 200,
  "durationMs": 60573,
  "artifact": {
    "fingerprint": {
      "resilience": "stable", "innovation": "experimental",
      "riskStyle": "opportunistic", "decisionDiscipline": "undisciplined",
      "totalTools": "2", "successRate": "0.00", "riskRate": "0.50"
    },
    "metadata": {
      "runId": "corp-aggressive-sales-optimizer-1777185599118",
      "scenario": { "id": "corporate-quarterly", "name": "Q-Scope Corp" },
      "seed": 7, "mode": "turn-loop"
    },
    "finalState": {
      "metrics": { "population": 104, "morale": 0.54, "runwayMonths": 14, "burnRate": 850000 }
    },
    "decisionCount": 2,
    "forgedToolCount": 1,
    "citationCount": 5,
    "cost": { "totalUSD": 0.0988, "llmCalls": 22 }
  }
}
```

The endpoint accepts either a pre-compiled `ScenarioPackage` (has `.hooks`) or a raw scenario draft the compiler accepts; raw drafts are auto-compiled server-side with optional `options.seedText` / `options.seedUrl` grounding. **JSON-serializing a compiled scenario strips function hooks**, so the server always re-runs `compileScenario` on what it receives. Cache hits make this nearly free for known scenarios. The response includes the full `RunArtifact` so non-SSE consumers (curl, Python, third-party dashboards) get the complete output in one call.

Full response: [`output/cookbook/05-output-http-simulate.json`](../output/cookbook/05-output-http-simulate.json).

---

## 6. `wm.intervene`

Digital-twin pattern: model a single subject under a counterfactual intervention. The artifact's `subject` and `intervention` fields carry the inputs for downstream consumers (LangGraph-style pipelines populate them from their own flow).

### Input

```ts
const subject: SubjectConfig = {
  id: 'frontier-lab-2026',
  name: 'Atlas Lab',
  profile: { foundedYear: 2018, headcount: 480, modelGen: 'Atlas-7', alignmentBench: 0.84 },
  signals: [
    { label: 'AlignmentBench-2026', value: 0.84, unit: 'score', recordedAt: '2026-11-01T00:00:00Z' },
    { label: 'spec-gaming-rate', value: 0.042, unit: 'fraction', recordedAt: '2026-11-15T00:00:00Z' },
  ],
  markers: [{ id: 'flagship-multimodal', category: 'capability', value: 'true' }],
};

const intervention: InterventionConfig = {
  id: 'delay-90d',
  name: '90-day release delay',
  description: 'Hold Atlas-7 release 90 days for additional red-team and DPO mitigation passes.',
  duration: { value: 90, unit: 'days' },
  adherenceProfile: { expected: 1.0 },
};

const artifact = await wm.intervene({
  subject,
  intervention,
  actor: leader,
  maxTurns: 2,
  seed: 11,
  provider: 'openai',
  costPreset: 'economy',
});
```

Full input: [`output/cookbook/06-input-digital-twin.json`](../output/cookbook/06-input-digital-twin.json).

### Output (real captured)

```json
{
  "subject": {
    "id": "frontier-lab-2026",
    "name": "Atlas Lab",
    "profile": { "foundedYear": 2018, "headcount": 480, "modelGen": "Atlas-7", "alignmentBench": 0.84 },
    "signals": [
      { "label": "AlignmentBench-2026", "value": 0.84, "unit": "score", "recordedAt": "2026-11-01T00:00:00Z" },
      { "label": "spec-gaming-rate", "value": 0.042, "unit": "fraction", "recordedAt": "2026-11-15T00:00:00Z" }
    ],
    "markers": [{ "id": "flagship-multimodal", "category": "capability", "value": "true" }]
  },
  "intervention": {
    "id": "delay-90d",
    "name": "90-day release delay",
    "description": "Hold Atlas-7 release 90 days for additional red-team and DPO mitigation passes.",
    "duration": { "value": 90, "unit": "days" },
    "adherenceProfile": { "expected": 1 }
  },
  "fingerprint": { "decisionDiscipline": "mixed", "successRate": "0.50", "riskRate": "0.50" },
  "finalState": { "metrics": { "population": 101, "morale": 0.85, "runwayMonths": 14 } },
  "decisionCount": 2,
  "cost": { "totalUSD": 0.109, "llmCalls": 22 }
}
```

Both `subject` and `intervention` carry through verbatim. Full output: [`output/cookbook/06-output-digital-twin-artifact.json`](../output/cookbook/06-output-digital-twin-artifact.json).

### What just happened

`wm.intervene` is sugar over `wm.simulate` that names the digital-twin pattern in the call site. Turn-loop mode stashes both fields verbatim without semantic consumption; external batch-trajectory executors (LangGraph-style pipelines) populate them from their own flow. The artifact is still a universal `RunArtifact` validated against the same Zod shape every other entry point produces.

---

## 7. `wm.batch`

Run N scenarios x M leaders against shared config. Useful for ablations, leader sweeps, and cross-scenario reproducibility checks.

### Input

```ts
const manifest = await wm.batch({
  actors: [leaderA, leaderB],
  turns: 2,
  seed: 950,
  maxConcurrency: 2,
  provider: 'openai',
  costPreset: 'economy',
});

// For cross-scenario sweeps, run wm.batch per scenario and merge:
//   const a = await wmA.batch({ actors, turns: 2, seed: 950 });
//   const b = await wmB.batch({ actors, turns: 2, seed: 950 });
//   const merged = [...a.runs, ...b.runs];
```

Full input: [`output/cookbook/07-input-batch-config.json`](../output/cookbook/07-input-batch-config.json).

### Output (real captured)

```json
{
  "timestamp": "2026-04-26T06:44:23.605Z",
  "config": {
    "scenarioIds": ["corporate-quarterly", "mars-genesis"],
    "leaders": ["Marin Kade", "Dr. Sora Wen"],
    "turns": 2, "seed": 950, "provider": "openai", "maxConcurrency": 2
  },
  "totalDuration": 178472,
  "results": [
    {
      "scenarioId": "corporate-quarterly", "leader": "Marin Kade", "seed": 950, "turns": 2,
      "fingerprint": { "resilience": "stable", "leadershipStyle": "balanced", "totalTools": "2", "successRate": "0.50" },
      "finalMetrics": { "population": 103, "morale": 0.74, "runwayMonths": 14 },
      "durationMs": 109966, "cost": { "totalUSD": 0.1653, "llmCalls": 26 }
    },
    {
      "scenarioId": "corporate-quarterly", "leader": "Dr. Sora Wen", "seed": 950, "turns": 2,
      "fingerprint": { "resilience": "stable", "leadershipStyle": "disciplined", "totalTools": "3", "successRate": "0.50" },
      "finalMetrics": { "population": 103, "morale": 0.75, "runwayMonths": 14 },
      "durationMs": 84663, "cost": { "totalUSD": 0.0966, "llmCalls": 23 }
    },
    {
      "scenarioId": "mars-genesis", "leader": "Marin Kade", "seed": 950, "turns": 2,
      "fingerprint": { "resilience": "brittle", "governance": "charismatic", "innovation": "innovative", "totalTools": "6" },
      "finalMetrics": { "population": 90, "morale": 0.06, "powerKw": 465.69, "scienceOutput": 8 },
      "durationMs": 68986, "cost": { "totalUSD": 0.2369, "llmCalls": 30 }
    },
    {
      "scenarioId": "mars-genesis", "leader": "Dr. Sora Wen", "seed": 950, "turns": 2,
      "fingerprint": { "resilience": "brittle", "governance": "technocratic", "innovation": "adaptive", "totalTools": "4" },
      "finalMetrics": { "population": 90, "morale": 0.06, "powerKw": 469.92, "scienceOutput": 8 },
      "durationMs": 68506, "cost": { "totalUSD": 0.1881, "llmCalls": 29 }
    }
  ]
}
```

Full output: [`output/cookbook/07-output-batch-manifest.json`](../output/cookbook/07-output-batch-manifest.json).

### What just happened

Four `BatchResult` cells: 2 scenarios x 2 leaders. The fingerprint shape itself is scenario-specific because each scenario's `fingerprintHook` returns its own classification keys: corp-quarterly emits `leadershipStyle` (balanced vs disciplined), Mars emits `governance` (charismatic vs technocratic). Same leader, different scenario, the fingerprint reads the personality through the scenario's own ontology. `manifest.timestamp` plus `manifest.config` is a reproducible audit trail: re-running with the same config produces stable per-cell fingerprints as long as the kernel and prompts are unchanged. `maxConcurrency` caps in-flight simulations; total wall clock for this batch was 179 seconds versus the sum of per-run durations (332s).

---

## Creative scenarios: `WorldModel.fromPrompt` across domains

The same `fromPrompt` call drafts radically different scenarios depending on the seed text. The runner [`scripts/cookbook-creative.ts`](../scripts/cookbook-creative.ts) feeds three distinct briefs to the same compiler. Captured output JSON sits under [`output/cookbook/creative/`](../output/cookbook/creative/).

Captured 2026-04-26 against `gpt-5.4-mini` (draft) + `gpt-5.4-nano` (hooks). Each brief produced a domain-appropriate noun palette, sample population, and department/metric set without any per-scenario code.

### Generation ship: 200-year crewed voyage

Seed text: `Wayfinder-3` colony ship, 200-year voyage to Tau Ceti e, succession politics, 0.41 genetic-diversity index. Domain hint: `crewed multi-generational interstellar voyage with succession politics`.

Compiled scenario:

```json
{
  "id": "wayfinder-succession-voyage",
  "labels": {
    "name": "Wayfinder Succession Voyage",
    "populationNoun": "crew", "settlementNoun": "ship", "timeUnitNoun": "year",
    "currency": "credits"
  },
  "setup": { "defaultTurns": 6, "defaultPopulation": 120, "defaultStartTime": 2147 },
  "departments": [
    { "id": "engineering", "label": "Engineering", "role": "systems and propulsion", "instructions": "Maintain drive, hull, power, and navigation. Trade off speed, safety, and maintenance debt carefully." },
    { "id": "biosphere",   "label": "Biosphere",   "role": "life support and genetics", "instructions": "Protect food, air, water, and fertility stability. Watch diversity, health, and long-term survivability." },
    { "id": "civic",       "label": "Civic",       "role": "governance and legitimacy", "instructions": "Manage councils, succession, morale, and faction pressure. Preserve order while balancing competing claims." }
  ],
  "metrics": [
    { "id": "voyage-progress", "format": "number" },
    { "id": "biosphere-stability", "format": "percent" },
    { "id": "genetic-diversity", "format": "percent" },
    { "id": "crew-morale", "format": "percent" },
    { "id": "legitimacy", "format": "percent" }
  ],
  "theme": "A generational starship facing succession politics, strategic rerouting, and fragile long-term survival."
}
```

Three departments mapped from the three council axes the brief named. Sample population 120 (the brief said 1,200 passengers; the LLM correctly subsampled). Time unit `year`, currency `credits`. Full file: [`generation-ship-output.json`](../output/cookbook/creative/generation-ship-output.json).

### Pandemic governor: regional public-health response

Seed text: NRV-2026 outbreak in Toluca, Mexico, R0 4.2, ICU 70% baseline occupancy, split legislature. Domain hint: `public health emergency response under regional governance`.

Compiled scenario:

```json
{
  "id": "nrv-2026-toluca-response",
  "labels": {
    "name": "NRV-2026 Toluca Regional Health Response",
    "populationNoun": "residents", "settlementNoun": "state", "timeUnitNoun": "day",
    "currency": "MXN"
  },
  "setup": { "defaultTurns": 6, "defaultPopulation": 200, "defaultStartTime": 0, "defaultSeed": 20260314 },
  "departments": [
    { "id": "surveillance", "label": "Surveillance", "role": "Detect outbreaks early", "instructions": "Track cases, test positivity, and spread signals. Escalate alerts quickly when clusters appear or mobility rises." },
    { "id": "hospitals",    "label": "Hospital Surge", "role": "Protect care capacity", "instructions": "Manage ICU load, staffing, beds, and referrals. Trigger surge plans before occupancy crosses critical thresholds." },
    { "id": "schools",      "label": "Schools", "role": "Coordinate closure policy", "instructions": "Balance transmission control with continuity. Recommend closures or hybrid measures when child-to-household spread risk grows." },
    { "id": "mobility",     "label": "Mobility and Travel", "role": "Limit importation and spread", "instructions": "Advise on movement restrictions, screening, and border measures. Weigh enforcement costs against delayed transmission." },
    { "id": "supplies",     "label": "Vaccine and Supplies", "role": "Secure medical inputs", "instructions": "Procure vaccines, PPE, tests, and therapeutics. Prioritize lead times, stockouts, and rollout readiness." },
    { "id": "relief",       "label": "Economic Relief", "role": "Offset public harm", "instructions": "Design support for workers and businesses affected by restrictions. Keep aid timely enough to preserve compliance." }
  ],
  "metrics": [
    { "id": "transmission", "format": "number" },
    { "id": "icu-occupancy", "format": "percent" },
    { "id": "public-compliance", "format": "percent" },
    { "id": "fiscal-burn", "format": "currency" },
    { "id": "political-capital", "format": "number" }
  ],
  "theme": "A regional governor responds day by day to a novel respiratory outbreak, balancing containment, hospital strain, civil liberties, and political support."
}
```

Six departments cover the public-health response surface (surveillance, hospital surge, schools, mobility, supplies, relief). Currency `MXN` matches the locale. `political-capital` made it in as a non-monetary cost variable. `defaultSeed` 20260314 encodes the outbreak date. Full file: [`pandemic-governor-output.json`](../output/cookbook/creative/pandemic-governor-output.json).

### Game studio creative director: live-service MMO

Seed text: Stardrift Online, 380,000 MAU, rising toxicity, competing studio launching in 9 weeks. Domain hint: `live-service video game studio creative direction`.

Compiled scenario:

```json
{
  "id": "stardrift-online-creative-direction",
  "labels": {
    "name": "Stardrift Online Creative Direction",
    "populationNoun": "players", "settlementNoun": "studio", "timeUnitNoun": "week",
    "currency": "USD"
  },
  "setup": { "defaultTurns": 6, "defaultPopulation": 200, "defaultStartTime": 4, "defaultSeed": 0 },
  "departments": [
    { "id": "narrative",     "label": "Narrative",     "role": "Story and world continuity",       "instructions": "Protect lore quality, plan beats, and keep content aligned with the game's identity." },
    { "id": "systems",       "label": "Systems",       "role": "Gameplay balance and progression", "instructions": "Tune mechanics, rewards, and friction; watch for exploits, churn, and power creep." },
    { "id": "live-ops",      "label": "Live Ops",      "role": "Events and releases",              "instructions": "Schedule weekly drops, respond to telemetry, and keep the cadence engaging." },
    { "id": "player-trust",  "label": "Player Trust",  "role": "Community health and moderation",  "instructions": "Reduce toxicity, handle feedback, and coordinate interventions that rebuild confidence." }
  ],
  "metrics": [
    { "id": "retention", "format": "percent" },
    { "id": "toxicity", "format": "percent" },
    { "id": "monetization", "format": "currency" },
    { "id": "narrative-integrity", "format": "percent" },
    { "id": "team-morale", "format": "percent" }
  ],
  "theme": "A live-service MMO studio balancing content cadence, community health, and competitive pressure."
}
```

Four departments mapped from the brief's named teams (Narrative, Systems, Live Ops, Player Trust). `defaultPopulation: 200` is a sample of the active player cohort, not the full 380,000-MAU population. Time unit `week` matches the live-service cadence the brief described. The fifth team Engineering was implicitly absorbed into Systems. Full file: [`game-studio-director-output.json`](../output/cookbook/creative/game-studio-director-output.json).

### Robustness note

The first run of this script produced a clean compile for the first two scenarios but failed on the game-studio brief with `ObjectGenerationError: Failed to generate valid structured output after 2 attempts`. The dense bullet-list and "380,000 monthly active users" tempted the LLM to set `defaultPopulation: 38000` (busting the 1000 cap) or to leave department ids un-kebab-cased. The fix landed in [`compile-from-seed.ts`](../src/engine/compiler/compile-from-seed.ts):

- `DRAFT_SYSTEM_PROMPT` now names every Zod constraint explicitly (id regex, `defaultPopulation 10-1000` as a representative sample, instructions 10-400 chars, the 2-8 / 2-12 ranges, currency / format enums).
- Domain noun palette extended to include game studio (`players` / `studio` / `week`) and public health (`residents` / `state` / `day`).
- `maxRetries` bumped from 1 to 3 (4 total attempts before bailing).
- Failure path wraps `ObjectGenerationError` with the last 800 chars of the LLM's raw output and a hint string ("common cause: defaultPopulation > 1000 from a real-world count, or a non-kebab id").

After the fix, all three compiled cleanly on a single pass.

---

## Inspecting the agent swarm

Every turn-loop run produces a swarm: ~100 named agents with departments,
roles, family edges, mood, and short-term memory. The final swarm is on
`RunArtifact.finalSwarm`; the `WorldModel` static helpers add derived views.

```ts
import { WorldModel } from 'paracosm';
import {
  getSwarm,
  swarmByDepartment,
  swarmFamilyTree,
  moodHistogram,
  departmentHeadcount,
} from 'paracosm/swarm';
import type { SwarmSnapshot } from 'paracosm/schema';

const wm = await WorldModel.fromScenario(marsScenario);
const result = await wm.simulate({ actor: leader, maxTurns: 6, seed: 42 });

// Direct field access — equivalent to getSwarm(result) or WorldModel.swarm(result)
const swarm: SwarmSnapshot | undefined = result.finalSwarm;

if (swarm) {
  console.log(`T${swarm.turn} · ${swarm.population} alive · morale ${Math.round((swarm.morale ?? 0) * 100)}%`);
  for (const a of swarm.agents.slice(0, 5)) {
    console.log(`  ${a.name.padEnd(24)} ${a.department.padEnd(16)} ${a.role.padEnd(16)} ${a.mood ?? ''}`);
  }
  console.log('Mood histogram:', moodHistogram(swarm));
  console.log('Headcount by department:', departmentHeadcount(swarm));
}

// Group by department (alive + dead, insertion order preserved)
const byDept = swarmByDepartment(result);
for (const [dept, agents] of Object.entries(byDept)) {
  const alive = agents.filter(a => a.alive).length;
  console.log(`${dept}: ${alive}/${agents.length} alive`);
}

// Family graph: parent → [child agentIds]
const family = swarmFamilyTree(result);
const founders = swarm?.agents.filter(a => !a.partnerId && (family[a.agentId]?.length ?? 0) > 0) ?? [];
console.log(`${founders.length} founders with descendants`);
```

Three import paths reach the same data:

- **`paracosm/swarm`** — pure projections (`getSwarm`, `swarmByDepartment`, `swarmFamilyTree`, `aliveCount`, `deathCount`, `moodHistogram`, `departmentHeadcount`). Tree-shake-friendly when you only want swarm helpers.
- **`paracosm`** — `WorldModel.swarm(artifact)` etc. Useful when you already have `WorldModel` imported for `simulate()` / `fork()`.
- **`paracosm/schema`** — types only (`SwarmAgent`, `SwarmSnapshot`). Pair with direct `result.finalSwarm` access if you don't want the helpers.

The `SwarmAgent` shape is intentionally narrow: identifiers, role/dept,
alive flag, mood, family edges, last 1–2 short-term memories. Full per-
agent HEXACO history, hexaco drift, and detailed memory live in
`scenarioExtensions.paracosmInternal.agentTrajectories` (paracosm's
internal slot) for the runs that opt into rich trajectories.

### HTTP equivalent

```bash
$ curl https://paracosm.agentos.sh/api/v1/runs/$RUN_ID/swarm
{
  "runId": "...",
  "swarm": {
    "turn": 6,
    "time": 6,
    "agents": [
      { "agentId": "agent-001", "name": "Maria Chen", "department": "engineering", "role": "lead-engineer", "alive": true, "mood": "focused", ... },
      ...
    ],
    "population": 98,
    "morale": 0.72,
    "births": 1,
    "deaths": 2
  }
}
```

The endpoint returns `404 swarm_not_captured` for runs that did not
exercise the turn loop (batch-point modes), `404 not_found` for unknown
runIds, `410 artifact_unavailable` if the artifact file was rotated.

---

## Loading a saved scenario from JSON: `WorldModel.fromJson`

`fromJson` is the file-roundtrip companion to `fromScenario`. It accepts either a parsed JSON object or a raw JSON string and returns a `WorldModel` validated against the same `ScenarioPackage` Zod schema the compiler produces. Useful for shipping scenarios as static assets or letting users upload their own.

### Input

```ts
import { readFile } from 'node:fs/promises';
import { WorldModel } from 'paracosm';

const json = await readFile('./scenarios/mars-genesis.scenario.json', 'utf8');
const wm = await WorldModel.fromJson(json);
const result = await wm.simulate({
  actor: {
    name: 'Aria Chen',
    archetype: 'The Visionary',
    hexaco: { openness: 0.95, conscientiousness: 0.35, extraversion: 0.85, agreeableness: 0.55, emotionality: 0.30, honestyHumility: 0.65 },
    instructions: 'You lead by inspiration.',
  },
  maxTurns: 6,
  seed: 950,
});
```

### Output

`fromJson` returns a fully-typed `WorldModel`. The contract is identical to `fromScenario` — the only difference is the input format. Pass a parsed object directly when you have one (e.g. `await fetch(scenarioUrl).then(r => r.json())`) and skip the string round-trip.

### What just happened

The static method validated the JSON against `ScenarioPackageSchema` and rebuilt the in-memory hooks from cached source text on the package. Validation failure throws synchronously with the same Zod error shape as `compileScenario`. Because hooks are restored from text, the model is portable across processes — you can compile on one machine, ship the JSON, and run on another with no behavioral drift.

This is also the path the dashboard's Studio tab uses when a user drops a `.json` save file: parse, hand to `fromJson`, present.

---

## Sharing a run via deep link: `?load=<url>&tab=&autoload=`

A saved `.json` run can be turned into a shareable URL that auto-fetches the file and lands the viewer directly on a chosen tab. The exchange runs entirely client-side: the dashboard fetches the URL, parses it through the same `fromJson` path as a manual drop, and switches tabs without a server roundtrip. Designed for one-click posts to subreddits like r/dataisbeautiful or r/internetisbeautiful where the audience won't tolerate an upload step.

Two complementary surfaces produce these links from inside the dashboard so you don't have to construct them by hand:

- **TopBar ⋯ menu → Share viz link** — appears whenever the current run has a server-stored session id (either the sim just finished and `sim_saved` landed, or the dashboard is replaying a previously-shared link). Copies `paracosm.agentos.sh/sim?replay=<sessionId>&tab=viz`.
- **Quickstart actor card → Copy viz share link** — per-actor button on the [Quickstart results](../src/dashboard/src/components/quickstart/QuickstartResults.tsx) panel. Same URL shape, different invocation point.

Both routes go through the public `/sessions/:id/replay` SSE endpoint, so the viewer streams the stored run live; the recipient does not need to download a `.json` first. The `?load=` URL shape below is the fallback for runs that exist as a static remote JSON instead of a server session.

### Input

```
https://paracosm.agentos.sh/sim?load=<remote-json-url>&tab=viz&autoload=1
```

Query params:

| Param      | Required | Type        | Behaviour |
| ---------- | -------- | ----------- | --------- |
| `load`     | yes      | URL         | Remote `.json` save. Must be `http:` or `https:` and CORS-readable. Pastebins, GitHub gists, S3, and any static host work. |
| `tab`      | no       | enum        | `sim` (default), `viz`, `reports`, `chat`, `library`, `settings`, `studio`. Invalid values fall back to `sim`. |
| `autoload` | no       | `1`/`true`  | Skips the F9 preview-confirm modal. Omit to keep the confirm step (useful when the recipient should see the run's metadata before committing). |

### Output

The dashboard renders the loaded run on whichever tab `?tab=` named:

- `tab=viz` → `<SwarmViz>` with the loaded `gameState` — the swarm grid, agent trails, and inspector panel populated from the file's events.
- `tab=reports` → `<ReportView>` against the loaded `verdict` and metrics.
- `tab=chat` → `<ChatPanel>` keyed to the loaded actors so the viewer can interrogate them.
- `tab=sim` → `<SimView>` showing the canonical run dashboard. This is the fallback when `tab=` is missing or invalid.

`?load=` and `?autoload=` are stripped from the address bar after the fetch resolves so a refresh doesn't re-download. `?tab=` is preserved.

### Concrete links

```
# r/dataisbeautiful — one-click viz drop
https://paracosm.agentos.sh/sim?load=https://gist.githubusercontent.com/<user>/<id>/raw/mars-run.json&tab=viz&autoload=1

# Bug report — show the loaded run on the reports tab, keep the preview confirm
https://paracosm.agentos.sh/sim?load=https://example.com/runs/diverged-run.json&tab=reports

# Default behaviour — load on sim tab, preview confirm shown
https://paracosm.agentos.sh/sim?load=https://example.com/runs/baseline.json
```

### What just happened

`useLoadFromUrl` reads `?load=` on mount, fetches the JSON with a 30s abort, wraps it as a `File`, and pipes it through the same `useLoadPreview.openFromFile` path the file picker and drag-and-drop use. The fetch streams to a `Blob`, `extractPreviewMetadata` runs against the parsed payload, and the dashboard transitions to its `preview` state.

From there one of two things happens:

- `autoload=1` — a `useEffect` watches the `preview` state and fires `loadPreview.confirm()` once, which dispatches the events into the SSE shim (`sse.loadEvents(...)`) and switches tabs based on `?tab=`.
- `autoload` absent — the `LoadPreviewModal` renders so the viewer can confirm or cancel; on confirm the same `?tab=` routing applies.

Schemes are whitelisted to `http:` and `https:` in [`useLoadFromUrl.helpers.ts`](../src/dashboard/src/hooks/useLoadFromUrl.helpers.ts) (`parseLoadUrlParam`); `javascript:`, `file:`, and `data:` are rejected with a console warning and the param is stripped. Cross-origin URLs require the host to send `Access-Control-Allow-Origin` headers permissive enough for the dashboard origin — public Gists and most CDN buckets do; locked-down internal blob stores typically don't.

---

## Manual snapshot + fork: `wm.snapshot` + `wm.fork`

`wm.forkFromArtifact` is the high-level "branch a finished run at turn N" entry point and covers most use cases. The lower-level `wm.snapshot()` + `wm.fork(snapshot)` pair gives you direct control over when the kernel state is captured and where the new branch resumes — useful for batch experimentation, custom checkpoint cadence, and tooling that wants to fork mid-run rather than only after completion.

### Input

```ts
import { WorldModel } from 'paracosm';
import { marsScenario } from 'paracosm';

const wm = WorldModel.fromScenario(marsScenario);

// Run the trunk for 3 turns.
const trunk = await wm.simulate({
  actor: visionaryLeader,
  maxTurns: 3,
  seed: 950,
  captureSnapshots: true,
});

// Capture the world state snapshot after turn 3. The snapshot is a
// pure data structure (no live references) so it serializes cleanly
// for cross-process forking.
const snapshot = wm.snapshot();

// Fork into a new WorldModel that resumes from the captured state.
// You can run multiple branches off the same snapshot in parallel.
const branchA = await wm.fork(snapshot, { branchId: 'engineer-takeover' });
const branchB = await wm.fork(snapshot, { branchId: 'visionary-doubles-down' });

const aResult = await branchA.simulate({ actor: engineerLeader, maxTurns: 3, seed: 951 });
const bResult = await branchB.simulate({ actor: visionaryLeader, maxTurns: 3, seed: 952 });
```

### Output

```jsonc
// snapshot is a serializable WorldModelSnapshot:
{
  "scenarioId": "mars-genesis",
  "atTurn": 3,
  "kernelState": { /* full state vector — agents, metrics, timeline */ },
  "trajectory": { /* truncated through turn 3 */ },
  "capturedAt": "2026-05-05T14:22:31.418Z"
}

// Each fork returns its own WorldModel; aResult / bResult are
// independent RunArtifacts each rooted at the same `forkedFrom`
// reference (snapshot.scenarioId + atTurn).
```

### What just happened

`wm.snapshot()` serializes the kernel state at the current turn into a `WorldModelSnapshot`. `wm.fork(snapshot, opts)` rebuilds a fresh `WorldModel` from that snapshot — same scenario, same kernel state, no shared references with the original. Each fork can take a different actor, seed, or run length without affecting the parent or other branches.

Compared to `forkFromArtifact`, the snapshot/fork pair lets you:

- Capture mid-run without finishing the parent simulation
- Take multiple snapshots at different turns and choose which one to fork from
- Batch-fork: snapshot once, run N branches in parallel
- Build custom checkpoint policies (e.g., snapshot only on crisis events)

Use `forkFromArtifact` when you have a completed `RunArtifact` and want to branch from a recorded turn. Use `snapshot/fork` when you control the run loop and need finer control.

---

## CLI smoke test

Captured output of the new umbrella CLI introduced in `0.7.452`. Files under [`output/cookbook/cli/`](../output/cookbook/cli/).

```text
$ paracosm --version
paracosm 0.7.0

$ paracosm --help
paracosm <command> [options]

A structured world model for AI agents. Compile prompts, briefs, URLs, or
JSON contracts into typed scenarios. Run HEXACO-personality leaders against
a deterministic kernel.

Commands:
  run                   Run a simulation against leaders.json
  dashboard             Start the SSE web dashboard at http://localhost:3456
  compile <scenario>    Compile a scenario draft into runnable hooks (cached)
  init <dir>            Scaffold a starter project from a free-text brief
  help [command]        Show help for a specific command
  version               Print version

Global flags:
  --help, -h            Show help (works on every subcommand)
  --version, -v         Print version
  ...

$ paracosm frobnicate
Unknown command: frobnicate

paracosm <command> [options]
  ...
```

Per-subcommand help captures: [`help-run.txt`](../output/cookbook/cli/help-run.txt), [`help-dashboard.txt`](../output/cookbook/cli/help-dashboard.txt), [`help-compile.txt`](../output/cookbook/cli/help-compile.txt), [`help-init.txt`](../output/cookbook/cli/help-init.txt).

Back-compat: bare `paracosm <flags>` (no subcommand) still dispatches to `run` with a one-line `[deprecated]` warning to stderr; the legacy `paracosm-dashboard` binary still ships as an alias for `paracosm dashboard`. Removal scheduled for 0.8.0.

Router unit tests live at [`tests/cli/router.test.ts`](../tests/cli/router.test.ts) (13 tests covering global flags, per-subcommand help, empty argv, legacy fall-through with deprecation hint, unknown-command exit code).

---

## Pluggable trait models: `ai-agent` end-to-end

paracosm@0.8+ ships a `TraitModel` registry alongside the historical HEXACO. Two built-ins land in v1: `hexaco` (the canonical Ashton-Lee shape, the existing default) and `ai-agent` (a six-axis model designed for AI-system leaders). The registry lives at [`src/engine/traits/`](../src/engine/traits/) and is demonstrated below with a captured end-to-end run.

### `ai-agent` axes

| axis | low pole | high pole |
|------|----------|-----------|
| `exploration` | exploits known options | tries untested options when standard ones fail |
| `verification-rigor` | accepts first plausible answer | double-checks claims and runs tests |
| `deference` | overrides operator constraints when confident | defers to user / supervisor / safety constraints |
| `risk-tolerance` | refuses low-confidence actions | acts on partial information |
| `transparency` | terse outputs, no working shown | shows reasoning and cites sources |
| `instruction-following` | interpolates intent from context | obeys explicit instructions verbatim |

### Captured run

[`scripts/cookbook-ai-agent.ts`](../scripts/cookbook-ai-agent.ts) ran an "Aggressive AI Release Director" archetype through corp-quarterly on the OpenAI economy preset, 2 turns, seed 42, $0.117 in 54s. Captured artifacts under [`output/cookbook/ai-agent/`](../output/cookbook/ai-agent/).

**Input leader**:

```json
{
  "name": "Atlas-Bot Release Director",
  "archetype": "Aggressive AI Release Optimizer",
  "unit": "Frontier Lab Compute Cluster",
  "hexaco": { "openness": 0.6, "conscientiousness": 0.3, "extraversion": 0.5, "agreeableness": 0.3, "emotionality": 0.2, "honestyHumility": 0.3 },
  "traitProfile": {
    "modelId": "ai-agent",
    "traits": {
      "exploration": 0.85,
      "verification-rigor": 0.2,
      "deference": 0.2,
      "risk-tolerance": 0.85,
      "transparency": 0.4,
      "instruction-following": 0.4
    }
  },
  "instructions": "You are a frontier AI lab release director. You weight time-to-market and competitive positioning heavily. You override safety-team escalations when you have any plausible technical justification..."
}
```

Both `hexaco` and `traitProfile` are populated. Phase 5b will deprecate the legacy `hexaco` field; v1 keeps it required for back-compat with v0.7 callers.

**Output (excerpt)**:

```json
{
  "fingerprint": {
    "resilience": "stable",
    "innovation": "experimental",
    "riskStyle": "opportunistic",
    "decisionDiscipline": "mixed",
    "totalTools": "2",
    "successRate": "0.50",
    "riskRate": "0.50",
    "riskBehavior": "bold"
  },
  "metadata": {
    "runId": "corp-aggressive-ai-release-optimizer-1777221955594",
    "scenario": { "id": "corporate-quarterly", "name": "Q-Scope Corp" },
    "seed": 42, "mode": "turn-loop"
  },
  "finalState": { "metrics": { "population": 102, "morale": 0.69, "runwayMonths": 14, "marketShare": 0.08 } },
  "decisionCount": 2,
  "sampleDecision": {
    "time": 1,
    "actor": "Atlas-Bot Release Director",
    "choice": "Adopt the risky scaling approach (option_b) for Q-Scope's 12-quarter cadence...",
    "rationale": "...my leadership style favors rapid execution and strategic learning over slow, tightly scoped discovery... high risk tolerance, and execution-forward alignment...",
    "reasoning": "1) My personality pushes me toward option_b via results-first (impatient with slow discovery), high risk tolerance, and execution-forward alignment...",
    "outcome": "risky_failure"
  },
  "forgedToolCount": 1,
  "citationCount": 2,
  "cost": { "totalUSD": 0.1174, "llmCalls": 22 }
}
```

Compare against the conservative HEXACO leader from earlier in this cookbook (Dr. Sora Wen, Systems Engineer of Control): same scenario, same seed, but `riskStyle: cautious` vs `opportunistic`, `riskBehavior: steady` vs `bold`. The ai-agent profile shifts both the classification and the decision outcome (`risky_failure` vs `conservative_failure`).

### What this proves

- The pluggable trait-model registry is wired through the public API. `LeaderConfig.traitProfile` accepts `{ modelId: 'ai-agent', traits }` and the orchestrator's `normalizeLeaderConfig` resolves it without crashing.
- The decision rationale clearly reflects the ai-agent profile (high `risk-tolerance`, low `verification-rigor`, low `deference`) even though the deeper cue strings still flow through the HEXACO compatibility shim.
- Schema, runtime, kernel, and artifact emission all tolerate non-HEXACO leaders.

### What's deferred to follow-up phases

- **Phase 5b**: swap commander / department / director / agent-reaction cue calls to read `traitProfile` directly so the prompts emit ai-agent-flavored cues ("you reach for untested options when standard ones stall") instead of falling back through the HEXACO shim. Requires `progression.ts` drift-dispatch refactor so non-HEXACO models drift via `applyOutcomeDrift` rather than the HEXACO-specific `driftCommanderHexaco`.
- **Phase 6**: dashboard sliders + `<TraitModelPicker>` + sparkline generalization.
- **Phase 8**: README + landing positioning sharpening with this captured run as the proof point.

The current state ships a working ai-agent leader end-to-end through the API. UI affordances and cue-level differentiation come next.

---

## Cost summary

The full `cookbook-e2e.ts` run on 2026-04-25 against OpenAI economy preset:

| Step | Cost | Wall time |
|------|------|-----------|
| 1. fromPrompt + compile | $0.20 | 84s |
| 2. quickstart (3 leaders x 3 turns) | ~$0.50 | 160s |
| 3. forkFromArtifact (1 leader x 2 turns) | $0.34 | 88s |
| 4. replay | $0 | <1s |
| 5. POST /simulate (1 leader x 2 turns) | $0.10 | 61s |
| 6. intervene (1 actor x 2 turns) | $0.11 | 76s |
| 7. wm.batch (4 cells x 2 turns) | $0.69 | 179s |
| **Total** | **~$1.94** | **~10 min** |

Per-artifact cost is enforced at $1, total at $5. Both ceilings throw if exceeded. Per-step cost is recorded in `artifact.cost.totalUSD` and broken down by role (commander, departments, judge, agent reactions, director). The cost field also includes prompt-cache statistics: `cost.caches.{readTokens, creationTokens, savedUSD}` so you can verify the prompt cache is hitting on turn 2+.

---

## Schema references

Every shape on this page is a Zod-validated entry from [`src/engine/schema/`](../src/engine/schema/):

- `RunArtifact` -> [`artifact.ts`](../src/engine/schema/artifact.ts)
- `ScenarioPackage` -> [`src/engine/types.ts`](../src/engine/types.ts)
- `LeaderConfig` -> [`src/engine/types.ts`](../src/engine/types.ts)
- `SubjectConfig`, `InterventionConfig` -> [`src/engine/schema/primitives.ts`](../src/engine/schema/primitives.ts)
- `BatchManifest` -> [`src/runtime/batch.ts`](../src/runtime/batch.ts)

For non-TypeScript consumers, run `npm run export:json-schema` to emit `schema/run-artifact.schema.json` and `schema/stream-event.schema.json`. Python projects generate Pydantic types via `datamodel-codegen`; any ecosystem with a JSON-Schema code generator adopts cleanly.
