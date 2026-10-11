# Paracosm and the World-Model Landscape

**Status:** current as of 2026-04-24.
**Purpose:** place paracosm on the April 2026 world-model taxonomy so readers can map it correctly in under 15 seconds.

---

## One sentence

Paracosm is a **structured counterfactual world model** for AI agents: prompts, briefs, URLs, or JSON drafts ground a typed `ScenarioPackage`; the deterministic seeded kernel, LLM-driven events, specialist analyses, HEXACO-personality leaders, and universal Zod-validated run artifact turn that contract into reproducible forked futures.

## Why "structured world model" is the right frame

The phrase "world model" in April 2026 covers two very different research agendas, both legitimate, both active, both funded. The ACM Computing Surveys 2025 survey ["Understanding World or Predicting Future? A Comprehensive Survey of World Models"](https://dl.acm.org/doi/full/10.1145/3746449) formally separates them:

1. **Understanding-world** world models: learn an *internal* representation that supports planning, decision-making, and counterfactual reasoning. Evaluated on action quality, not pixel fidelity. This is the lineage paracosm belongs to.
2. **Predicting-future** world models: generate perceptual futures (video, 3D scenes) as explicit outputs. Evaluated on visual fidelity and physical consistency. Sora, Genie 3, Marble belong here.

Eric Xing's paper ["Critiques of World Models"](https://arxiv.org/abs/2507.05169) (2025) is the sharpest articulation of this split:

> A world model is NOT about generating videos for viewing-pleasure, but IS about simulating all actionable possibilities of the world to serve as a sandbox for general-purpose reasoning via thought-experiments.

Paracosm is exactly that sandbox. Every turn, the engine simulates an *actionable possibility* ("what does this leader decide given this event, this state, these specialist analyses") and the deterministic kernel applies consequences. Two runs against the same seed with two different leaders surface the counterfactual directly.

[Yang et al, 2026](https://openreview.net/forum?id=XmYCERErcD) is the closest implementation anchor for the LLM version of this claim: it evaluates LLM-based world models as decision-making systems through policy verification, action proposal, and policy planning. [Gurnee and Tegmark, ICLR 2024](https://arxiv.org/abs/2310.02207) is the representation anchor: modern LLMs show structured space/time representations, which is evidence for basic world-model ingredients without proving full grounded understanding. Paracosm's product stance is therefore conservative: do not trust hidden model weights alone. Externalize the world into a typed schema, citations, tools, snapshots, and a seeded kernel, then let the LLM reason over that explicit structure.

## Input model: source material vs contract

Paracosm should not be described as "from JSON" as if JSON were the whole product. JSON is the durable contract.

| Layer | What users provide | What Paracosm does |
|---|---|---|
| Source material | Prompt, pasted brief, PDF text, policy memo, fiction, web URL, or hand-written scenario JSON | Extracts topics, facts, citations, constraints, and likely dynamics. `WorldModel.fromPrompt({ seedText, sourceUrl, domainHint })` drafts and compiles a scenario from the material alone, and `run()` / `runMany()` wrap it; `compileScenario()` takes the same material as `seedText` / `seedUrl` to ground a hand-written draft. |
| Canonical contract | `ScenarioPackage` / scenario JSON draft | Validates five state bags, labels, departments, metrics, setup defaults, and generated hooks. This is the checkpointable world model the kernel can replay. |
| Simulation state | Kernel snapshot + `RunArtifact` | Persists deterministic replay state, fork lineage, decisions, timepoints, citations, forged tools, costs, and final world snapshot. |

The rule is strict: prompt-only authoring may generate the contract, but it may not bypass the contract. If the LLM cannot produce a valid `ScenarioPackage`, there is no world to simulate.

## The five approaches, and where paracosm sits

Working from [Themesis "Five Competing Approaches"](https://themesis.com/2026/01/07/world-models-five-competing-approaches/), with paracosm mapped in:

| Approach | What it is | Representative projects | Paracosm? |
|---|---|---|---|
| Generative visual / spatial | Pixel or 3D-scene generators trained on video and 3D data | [OpenAI Sora](https://openai.com/sora), [DeepMind Genie 3](https://deepmind.google/discover/blog/genie-3/), [World Labs Marble](https://www.worldlabs.ai/) | No. Paracosm never renders pixels. |
| JEPA / predictive representation | Joint-embedding self-supervised learners; predict *representations* of future state, not pixels | [LeCun V-JEPA / AMI Labs](https://techcrunch.com/2026/03/09/yann-lecuns-ami-labs-raises-1-03-billion-to-build-world-models/) | No. Paracosm does not train a neural network. |
| Object-centric / symbolic | Compositional representations of objects and their dynamics | [AXIOM (Verses / Friston)](https://verses.ai) | Adjacent. Paracosm is symbolic in state representation but relies on LLMs for event generation and decision-making rather than learned object dynamics. |
| **Structured / LLM-based / LLM-induced** | LLM acts as the environment-dynamics simulator, augmented by auxiliary modules (deterministic kernels, structured state, validated schemas, research grounding) | **Paracosm** | **Yes, this is us.** |
| Hybrid / foundation | Mix neural and simulator components into a generalist architecture | Xing's [PAN (Physical, Agentic, Nested)](https://huggingface.co/papers/2507.05169) | Forward-compatible. Paracosm's universal artifact schema is a plausible contract layer for a PAN-style stack. |

## Counterfactual World Simulation Models (CWSMs)

Inside the "structured / LLM-based" branch, paracosm's specific research lineage is **counterfactual world simulation models**: simulators designed to replay an event with one variable changed and surface the divergence. Kirfel et al, 2025, ["When AI meets counterfactuals: the ethical implications of counterfactual world simulation models"](https://link.springer.com/article/10.1007/s43681-025-00718-4) introduces the term CWSM and its use in legal and policy settings.

Paracosm operationalizes CWSMs:

- **The constant:** compiled scenario contract + seeded PRNG + kernel lifecycle. Same inputs → identical agent rosters, lifecycles, promotions.
- **The counterfactual:** leader HEXACO personality profile. Swap one leader for another and every LLM-driven stage diverges.
- **The measurement:** `fingerprint` + per-turn `stateSnapshotAfter` + `specialistNotes[]` + `decisions[]` + final `worldSnapshot` across all five state bags.
- **The API:** `WorldModel.fork()` (shipped in 0.7.x) lets callers branch a run at any past turn. Parent runs created with `captureSnapshots: true` carry per-turn kernel snapshots in `scenarioExtensions.kernelSnapshotsPerTurn`; `WorldModel.forkFromArtifact(artifact, atTurn)` reads one, restores the kernel verbatim, and returns a fresh `WorldModel` ready to simulate from `atTurn + 1` with a supplied leader. `metadata.forkedFrom` on the child artifact links back to the parent for chain reconstruction.

### Onboarding: prompt or document is the authoring surface, JSON is the contract

Paracosm accepts prompt text, briefs, URLs, and PDFs as seed source material. `WorldModel.fromPrompt` asks an LLM to propose a scenario draft against `DraftScenarioSchema`, validates it, and routes it into the canonical `compileScenario` pipeline. No prompt-only path bypasses the kernel or the schema. This keeps the ingestion surface permissive while preserving every reproducibility guarantee (seeded PRNG, deterministic transitions, Zod-validated artifacts) that the structured-world-model positioning rests on. The dashboard's Quickstart tab composes `fromPrompt` + `wm.quickstart` into a one-click "seed in, three HEXACO counterfactuals out" experience; external consumers integrate the same two calls programmatically. A curated library of 10 HEXACO archetypes exported as `ACTOR_PRESETS` from `paracosm` provides default leaders for batch sweeps and the dashboard's Swap control.

Related academic work on LLM-counterfactual simulation:

- [Integrating Counterfactual Simulations with Language Models for Explaining Multi-Agent Behaviour (AXIS): arXiv 2505.17801](https://arxiv.org/html/2505.17801v1) uses LLMs to explore counterfactual worlds in autonomous-driving scenarios.
- [Counterfactual Effect Decomposition in Multi-Agent Sequential Decision Making: ICML 2025 (sepsis management simulator)](https://icml.cc/virtual/2025/poster/44311) attributes effects to individual agents via Shapley.
- [Abstract Counterfactuals for Language Model Agents: arXiv 2506.02946](https://arxiv.org/html/2506.02946v1) proposes semantic (not token-level) counterfactuals.

## Anti-positioning: what paracosm is NOT

Every one of these categories is legitimate and important. None of them describe paracosm. Naming them up front saves everyone a misclassification cycle.

### Not a generative visual / spatial world model

Sora (OpenAI), Genie 3 (DeepMind), Marble (World Labs) generate pixel-level or 3D-scene outputs. They optimize for visual and physical realism, used by filmmakers and 3D artists. Paracosm's output is a structured `RunArtifact`: metrics, decisions, specialist notes, citations, forged tool summaries. No pixels. [Not Boring's "World Models: Computing the Uncomputable"](https://www.notboring.co/p/world-models) is a good primer on that branch; it does not describe what paracosm is.

### Not a JEPA-style predictive-representation model

Yann LeCun's [AMI Labs raised $1.03B on 2026-03-09](https://techcrunch.com/2026/03/09/yann-lecuns-ami-labs-raises-1-03-billion-to-build-world-models/) to train Joint-Embedding Predictive Architectures on sensor and video streams. Paracosm does not train a model. It composes a kernel + LLM reasoner. `compileScenario` uses an LLM to generate TypeScript hook functions, but that's code synthesis, not representation learning.

### Not a multi-agent task orchestration framework

LangGraph, AutoGen / AG2, CrewAI, OpenAI Agents SDK, Google ADK, Mastra: these build agentic workflows that execute real tasks against real tools and real APIs. Their output reaches the real world. Paracosm is a simulation; nothing ships outside the run. [Turing's "Detailed Comparison of Top 6 AI Agent Frameworks"](https://www.turing.com/resources/ai-agent-frameworks) is the current canonical side-by-side of that category; paracosm isn't on it and shouldn't be.

### Top-down agent swarm, not bottom-up emergent swarm

[MiroFish](https://github.com/666ghj/MiroFish) and its upstream [OASIS (CAMEL-AI): OpenReview](https://openreview.net/forum?id=JBzTculaVV) build open-ended social simulations with thousands to one million LLM-driven agents interacting on social-media-shaped substrates. Output is an aggregate prediction report of emergent collective behavior. Paracosm runs a top-down agent swarm: one leader decides, a swarm of specialists and ~100 personality-typed cells reacts, and the output is a deterministic trajectory plus measurable divergence across leaders rather than an emergent-crowd forecast. Both shapes are valid agent swarm architectures; paracosm's lane is the directed, replayable, decision-support side.

| Axis | MiroFish / OASIS | Paracosm |
|---|---|---|
| Direction | Bottom-up, emergent | Top-down, leader-driven |
| Scale | 1,000s to 1,000,000 agents | ~100 agents + 5 specialists + 1 commander |
| Determinism | Emergent / non-deterministic | Seeded kernel; divergence is purely from leader personality |
| Input | Seed document (news, policy, fiction) | Prompt/document/URL or JSON draft → `ScenarioPackage` + HEXACO leader |
| Output | Aggregate prediction report | Universal `RunArtifact` (trajectory, decisions, specialist notes, forged tools, citations, cost) |
| Primary use | Forecasting | Decision support, counterfactual analysis, digital twins |
| Language | Python | TypeScript / ESM |

### Not a generative-agents / generative agent-based modeling library

[Stanford Generative Agents (Park et al, 2023)](https://arxiv.org/abs/2304.03442) populated Smallville with 25 LLM-driven characters that plan, reflect, and form relationships: "interactive simulacra of human behavior." [Google DeepMind Concordia](https://deepmind.google/research/publications/64717/) generalizes that with a "Game Master" concept and actions grounded in physical, social, or digital space. Both are libraries for studying emergent social behavior. Paracosm is a product: a deterministic kernel with a turn loop, personality drift, runtime tool forging, and a universal result schema for downstream consumers.

### Not a classical agent-based modeling framework

Mesa, NetLogo, MASON, AnyLogic, ABIDES: longstanding ABM tooling, generally rule-based or statistical, generally non-LLM. Paracosm's closest ancestors in that family are [the Nature HSSC 2024 survey on LLM-empowered ABM](https://www.nature.com/articles/s41599-024-03611-3) and [MIT Media Lab's "On the limits of agency in agent-based models"](https://arxiv.org/abs/2409.10568). Read those papers for the theoretical backdrop, not for a paracosm competitor.

## The seven claim pillars

Every public paracosm surface: README, landing page, feature docs, blog posts, npm description, GitHub repo description: anchors its claims to one of these seven. Anything outside this list is a candidate for removal.

### 1. Structured

State is JSON-declared after compilation, five-bag: `metrics` (numeric gauges), `capacities` (upper bounds), `statuses` (categorical), `politics` (social pressure), `environment` (external conditions). Prompt text, briefs, documents, and URLs are source material; the compiled JSON / `ScenarioPackage` is the replayable contract. Schemas live in [`src/engine/types.ts`](../../src/engine/types.ts) and the universal public contract lives in [`src/engine/schema/`](../../src/engine/schema/).

### 2. Reproducible

Kernel state transitions use a Mulberry32-seeded PRNG. Same seed produces identical agent rosters, lifecycle schedules, promotion sequences, and resource starting values. See [`src/engine/core/`](../../src/engine/core/).

### 3. Counterfactual-first

The product is two runs against the same seed with different leaders, and a surfaced divergence. `wm.batch` scales this to N actors against a compiled world. See [`src/runtime/batch.ts`](../../src/runtime/batch.ts).

### 4. Personality-grounded

HEXACO-PI-R six-factor model (Ashton & Lee 2007, Personality and Social Psychology Review 11(2), [doi:10.1177/1088868306294907](https://doi.org/10.1177/1088868306294907)). Drift under three forces: leader-pull, role-activation, outcome-reinforcement. See [`src/engine/core/state.ts`](../../src/engine/core/state.ts) and [`src/runtime/hexaco-cues/`](../../src/runtime/hexaco-cues/).

### 5. Research-grounded

Seed-ingestion pipeline via AgentOS `WebSearchService` (Firecrawl, Tavily, Serper, Brave in parallel) with Cohere `rerank-v3.5` neural reranking. DOI-linked citations propagate through every department report. See [`src/engine/compiler/seed-ingestion.ts`](../../src/engine/compiler/seed-ingestion.ts) and [`src/runtime/research/`](../../src/runtime/research/).

### 6. Tool-forging capable

Specialists write JavaScript tools at runtime. Execution runs in AgentOS's `CodeSandbox`, an in-process node:vm context, with a 10 s timeout and no network or file access; heap usage is observed but not preemptively capped by node:vm. An LLM judge approves before the tool enters the decision pipeline. Approved tools are reused on later turns via `call_forged_tool` at near-zero marginal cost: reuse economics are the single largest lever on total run spend. Via AgentOS `EmergentCapabilityEngine` + `EmergentJudge`. See [`src/runtime/orchestrator/emergent-setup.ts`](../../src/runtime/orchestrator/emergent-setup.ts).

### 7. Universal artifact

One Zod-validated `RunArtifact` schema covers three simulation modes:

- `turn-loop`: civilization simulations (paracosm's native mode)
- `batch-trajectory`: digital-twin simulations with labeled timepoints over a horizon
- `batch-point`: one-shot forecasts with overview and risk flags

JSON Schema export via `npm run export:json-schema` for non-TypeScript consumers (Python projects can generate Pydantic types via `datamodel-codegen`). See [`src/engine/schema/`](../../src/engine/schema/).

## References

- [Critiques of World Models: Xing, arXiv 2507.05169](https://arxiv.org/abs/2507.05169): the structured-vs-generative split.
- [Understanding World or Predicting Future? A Comprehensive Survey of World Models: ACM CSUR 2025](https://dl.acm.org/doi/full/10.1145/3746449): the two-branch taxonomy.
- [When AI meets counterfactuals: the ethical implications of counterfactual world simulation models: Kirfel et al, 2025](https://link.springer.com/article/10.1007/s43681-025-00718-4): the CWSM term and use cases.
- [LLM-Based World Models Can Make Decisions Solely, But Rigorous Evaluations are Needed: Yang et al, TMLR 2026](https://openreview.net/forum?id=XmYCERErcD): LLM-based world models evaluated through verification, proposal, and planning.
- [Language Models Represent Space and Time: Gurnee and Tegmark, ICLR 2024](https://arxiv.org/abs/2310.02207): evidence that LLMs learn structured spatiotemporal representations, with limits.
- [Large Language Model Based Multi-agents: A Survey of Progress and Challenges: IJCAI 2024](https://www.ijcai.org/proceedings/2024/890): LLM-MA as world simulation.
- [Large language models empowered agent-based modeling and simulation: Nature HSSC 2024](https://www.nature.com/articles/s41599-024-03611-3)
- [On the limits of agency in agent-based models: MIT Media Lab](https://arxiv.org/abs/2409.10568)
- [World Models: Five Competing Approaches: Themesis 2026-01-07](https://themesis.com/2026/01/07/world-models-five-competing-approaches/)
- [Generative Agents: Interactive Simulacra of Human Behavior: Park et al, 2023, arXiv 2304.03442](https://arxiv.org/abs/2304.03442)
- [Concordia: Google DeepMind](https://deepmind.google/research/publications/64717/)
- [OASIS: CAMEL-AI, OpenReview](https://openreview.net/forum?id=JBzTculaVV)
- [MiroFish: github.com/666ghj/MiroFish](https://github.com/666ghj/MiroFish)
- [When Digital Twins Meet LLMs: arXiv 2507.00319](https://arxiv.org/abs/2507.00319)
- [HEXACO model: Ashton & Lee, 2007, Personality and Social Psychology Review 11(2): doi:10.1177/1088868306294907](https://doi.org/10.1177/1088868306294907)
- [Agent World Models: Internal Simulations for Planning and Prediction: CallSphere](https://callsphere.tech/blog/agent-world-models-internal-simulations-planning-prediction)
