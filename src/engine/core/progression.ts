import type { Agent, WorldMetrics, TurnEvent, SimulationState, HexacoProfile, TurnOutcome } from './state.js';
import { HEXACO_TRAITS } from './state.js';
import { SeededRng } from './rng.js';
import type { ProgressionHookContext } from '../types.js';
import { ageInYears, unitsToYears } from './time-unit.js';

// Trait activation profiles per department role (Tett & Burnett 2003)
const ROLE_ACTIVATIONS: Record<string, Partial<HexacoProfile>> = {
  medical:     { conscientiousness: 0.7, emotionality: 0.6, agreeableness: 0.6 },
  engineering: { conscientiousness: 0.9, openness: 0.3 },
  agriculture: { conscientiousness: 0.6, agreeableness: 0.7, openness: 0.5 },
  psychology:  { agreeableness: 0.8, emotionality: 0.7, openness: 0.6 },
  governance:  { extraversion: 0.7, honestyHumility: 0.6 },
};

export { ROLE_ACTIVATIONS };

/**
 * Per-trait outcome-pull magnitudes covering all six HEXACO axes.
 *
 * Values are small (≤ 0.03) so combined with leader-pull (0.02) and
 * role-pull (0.01) the per-turn rate cap (±0.05) is still reachable but
 * not routinely exceeded. Each entry is anchored in trait-activation
 * research so the drift reads as plausible personality evolution rather
 * than arbitrary numerical churn.
 *
 * Citations:
 *   Openness ↔ exploration success — Silvia & Sanders 2010
 *   Conscientiousness ↔ discipline under failure — Roberts et al. 2006
 *   Extraversion reward sensitivity — Smillie et al. 2012
 *   Agreeableness ↔ cooperation under abundance — Graziano et al. 2007
 *   Emotionality activation under threat — Lee & Ashton 2004
 *   Honesty-Humility ↔ strategic behavior — Hilbig & Zettler 2009
 */
function outcomePullForTrait(trait: keyof HexacoProfile, outcome: TurnOutcome): number {
  switch (trait) {
    case 'openness':
      if (outcome === 'risky_success') return 0.03;
      if (outcome === 'risky_failure') return -0.04;
      if (outcome === 'conservative_failure') return 0.02;
      return 0;
    case 'conscientiousness':
      if (outcome === 'risky_failure') return 0.03;
      if (outcome === 'conservative_success') return 0.02;
      return 0;
    case 'extraversion':
      // bold call paid off reinforces assertive command presence
      if (outcome === 'risky_success') return 0.02;
      // public embarrassment after bold call
      if (outcome === 'risky_failure') return -0.02;
      return 0;
    case 'agreeableness':
      // team coordination worked
      if (outcome === 'conservative_success') return 0.02;
      // interpersonal friction after loss
      if (outcome === 'risky_failure') return -0.02;
      return 0;
    case 'emotionality':
      // crisis heightens anxiety/empathy (Lee & Ashton 2004 Table 1)
      if (outcome === 'risky_failure') return 0.03;
      if (outcome === 'conservative_failure') return 0.02;
      return 0;
    case 'honestyHumility':
      // survivors-write-history: bold wins erode transparent attribution
      if (outcome === 'risky_success') return -0.02;
      // measured honesty rewarded
      if (outcome === 'conservative_success') return 0.02;
      return 0;
    default:
      return 0;
  }
}

/**
 * Apply personality drift to all promoted colonists. Deterministic from inputs.
 * Three forces: leader pull, role pull, outcome pull.
 */
export function applyPersonalityDrift(
  colonists: Agent[],
  commanderHexaco: HexacoProfile,
  turnOutcome: TurnOutcome | null,
  timeDelta: number,
  turn: number,
  time: number,
): void {
  for (const c of colonists) {
    if (!c.health.alive || !c.promotion) continue;

    const dept = c.promotion.department;
    const activation = ROLE_ACTIVATIONS[dept] ?? {};

    for (const trait of HEXACO_TRAITS) {
      let pull = 0;

      // Leader pull: traits converge toward commander (Van Iddekinge 2023)
      pull += (commanderHexaco[trait] - c.hexaco[trait]) * 0.02;

      // Role pull: department role activates specific traits (Tett & Burnett 2003)
      if (activation[trait] !== undefined) {
        pull += (activation[trait]! - c.hexaco[trait]) * 0.01;
      }

      // Outcome pull: success/failure reinforces or punishes traits.
      // Covers all six HEXACO axes; see outcomePullForTrait for the
      // per-trait table and peer-reviewed citations.
      if (turnOutcome) {
        pull += outcomePullForTrait(trait, turnOutcome);
      }

      // Rate cap and bounds
      const delta = Math.max(-0.05, Math.min(0.05, pull)) * timeDelta;
      c.hexaco[trait] = Math.max(0.05, Math.min(0.95, c.hexaco[trait] + delta));
    }

    c.hexacoHistory.push({ turn, time, hexaco: { ...c.hexaco } });
  }
}

/**
 * Apply outcome-pull drift to the commander's HEXACO profile.
 *
 * Unlike {@link applyPersonalityDrift} which runs on promoted agents,
 * the commander has no leader to pull them (they ARE the leader) and no
 * department role to activate. Only outcome-pull applies. Same rate cap
 * (±0.05/turn) and bounds [0.05, 0.95] so commander drift and agent
 * drift stay in the same numerical regime.
 *
 * Mutates `leaderHexaco` and `history` in place. Callers should push a
 * baseline snapshot `{ turn: 0, time, hexaco: {...initial} }` onto
 * `history` BEFORE the first call so downstream consumers of
 * `history[0]` see the starting baseline, not the first drifted state.
 */
export function driftCommanderHexaco(
  leaderHexaco: HexacoProfile,
  outcome: TurnOutcome | null,
  timeDelta: number,
  turn: number,
  time: number,
  history: Array<{ turn: number; time: number; hexaco: HexacoProfile }>,
): void {
  for (const trait of HEXACO_TRAITS) {
    let pull = 0;
    if (outcome) pull += outcomePullForTrait(trait, outcome);
    const delta = Math.max(-0.05, Math.min(0.05, pull)) * timeDelta;
    leaderHexaco[trait] = Math.max(0.05, Math.min(0.95, leaderHexaco[trait] + delta));
  }
  history.push({ turn, time, hexaco: { ...leaderHexaco } });
}

/**
 * Classify turn outcome as risky/conservative success/failure.
 * Deterministic from seed + decision text.
 */
export function classifyOutcome(
  decisionText: string,
  riskyOption: string,
  riskSuccessProbability: number,
  metrics: WorldMetrics,
  rng: SeededRng,
): TurnOutcome {
  const isRisky = decisionText.toLowerCase().includes(riskyOption.toLowerCase());

  let prob = riskSuccessProbability;
  if (metrics.morale > 0.7) prob += 0.1;
  // A food store adds to the odds only in a run that carries one.
  if (typeof metrics.foodMonthsReserve === 'number' && metrics.foodMonthsReserve > 12) prob += 0.05;
  if (metrics.population > 150) prob -= 0.05;
  prob = Math.max(0.1, Math.min(0.9, prob));

  const success = rng.chance(prob);

  if (isRisky && success) return 'risky_success';
  if (isRisky && !success) return 'risky_failure';
  if (!isRisky && success) return 'conservative_success';
  return 'conservative_failure';
}

/**
 * Classify turn outcome using structured option ID.
 * Preferred over text-based classifyOutcome.
 */
export function classifyOutcomeById(
  selectedOptionId: string,
  options: Array<{ id: string; isRisky: boolean }>,
  riskSuccessProbability: number,
  metrics: WorldMetrics,
  rng: SeededRng,
): TurnOutcome {
  const selected = options.find(o => o.id === selectedOptionId);
  const isRisky = selected?.isRisky ?? false;

  let prob = riskSuccessProbability;
  if (metrics.morale > 0.7) prob += 0.1;
  // A food store adds to the odds only in a run that carries one.
  if (typeof metrics.foodMonthsReserve === 'number' && metrics.foodMonthsReserve > 12) prob += 0.05;
  if (metrics.population > 150) prob -= 0.05;
  prob = Math.max(0.1, Math.min(0.9, prob));

  const success = rng.chance(prob);

  if (isRisky && success) return 'risky_success';
  if (isRisky && !success) return 'risky_failure';
  if (!isRisky && success) return 'conservative_success';
  return 'conservative_failure';
}

/**
 * A yearly probability held over `years` years: `1 - (1 - pYear)^years`.
 * A turn of eight years at 1 percent a year is 7.7 percent; a month at 8
 * percent a year is 0.69 percent. No cap: the rate means what it says
 * however long the turn.
 */
export function turnHazard(pYear: number, years: number): number {
  if (!(pYear > 0) || !(years > 0)) return 0;
  if (pYear >= 1) return 1;
  return 1 - Math.pow(1 - pYear, years);
}

/** Accident weight by department: who is more often in harm's way. */
const ROLE_ACCIDENT_WEIGHT: Record<string, number> = {
  engineering: 1.5,
  medical: 1.2,
  agriculture: 1.0,
  science: 0.9,
  psychology: 0.6,
  governance: 0.5,
};

/** Each cause of death's chance for one person over one turn. */
export interface CauseHazards {
  natural: number;
  radiation: number;
  starvation: number;
  despair: number;
  fracture: number;
  accident: number;
}

/**
 * Each cause of death's chance for `agent` over a turn of `years` years,
 * from its yearly rate and the state it reads:
 *
 * - natural: 1, 3, 8 and 20 percent a year from ages 60, 70, 80 and 90;
 * - radiation cancer: 0.004 a year for each sievert of cumulative dose
 *   above 0.5, from age 30;
 * - starvation: `(1 - foodMonthsReserve) * 0.15` a year while the colony
 *   holds under a month of food;
 * - despair: `(0.2 - psychScore) * 0.25 * (0.5 + emotionality)` a year
 *   while psych is under 0.2, from age 18;
 * - fracture: `(60 - boneDensityPct) * 0.003` a year under 60 percent
 *   bone density, from age 40;
 * - accident: 0.003 a year times the department's weight, from age 18.
 */
export function causeHazards(
  agent: Agent,
  metrics: Readonly<Record<string, unknown>>,
  ageYears: number,
  years: number,
): CauseHazards {
  const health = agent.health;
  let natural = 0;
  if (ageYears >= 90) natural = 0.20;
  else if (ageYears >= 80) natural = 0.08;
  else if (ageYears >= 70) natural = 0.03;
  else if (ageYears >= 60) natural = 0.01;

  const doseSv = (health.cumulativeRadiationMsv ?? 0) / 1000;
  const radiation = ageYears >= 30 ? 0.004 * Math.max(0, doseSv - 0.5) : 0;

  const food = metrics.foodMonthsReserve;
  const starvation = typeof food === 'number' && food < 1 ? (1 - food) * 0.15 : 0;

  const despair = ageYears >= 18 && health.psychScore < 0.2
    ? (0.2 - health.psychScore) * 0.25 * (0.5 + agent.hexaco.emotionality)
    : 0;

  const bone = health.boneDensityPct;
  const fracture = ageYears >= 40 && typeof bone === 'number' && bone < 60 ? (60 - bone) * 0.003 : 0;

  const accident = ageYears >= 18
    ? 0.003 * (ROLE_ACCIDENT_WEIGHT[agent.core.department ?? 'science'] ?? 1.0)
    : 0;

  return {
    natural: turnHazard(natural, years),
    radiation: turnHazard(radiation, years),
    starvation: turnHazard(starvation, years),
    despair: turnHazard(despair, years),
    fracture: turnHazard(fracture, years),
    accident: turnHazard(accident, years),
  };
}

/**
 * Run all between-turn progression: aging, mortality, births, careers,
 * health degradation, resource production. All deterministic from seed.
 *
 * `timeDelta` is in the scenario's unit. Ages, experience and every
 * yearly rate are in years: `yearsPerUnit` (default: the state's
 * `metadata.yearsPerUnit`, else 1) converts the step, so a month of Atlas
 * Lab ages its people a twelfth of a year and rolls a twelfth of a
 * year's births and deaths.
 */
export function progressBetweenTurns(
  state: SimulationState,
  timeDelta: number,
  turnRng: SeededRng,
  progressionHook?: (ctx: ProgressionHookContext) => void,
  yearsPerUnit: number = state.metadata.yearsPerUnit ?? 1,
): { state: SimulationState; events: TurnEvent[] } {
  const events: TurnEvent[] = [];
  const time = state.metadata.currentTime;
  const turn = state.metadata.currentTurn;
  let colonists = state.agents.map(c => structuredClone(c));
  let metrics = structuredClone(state.metrics);
  /** The step in years: what every yearly rate below scales by. Not
   *  rounded, so experience added a month at a time stays exact. */
  const yearsDelta = timeDelta * yearsPerUnit;
  const ageOf = (c: Agent) => ageInYears(c, time, yearsPerUnit);

  // 1. Age all colonists (generic: experience, earth contacts)
  for (const c of colonists) {
    if (!c.health.alive) continue;
    c.career.yearsExperience += yearsDelta;

    // Earth contacts decay
    if (c.social.earthContacts > 0 && turnRng.chance(0.15 * yearsDelta)) {
      c.social.earthContacts = Math.max(0, c.social.earthContacts - 1);
    }
  }

  // 1b. Scenario-specific progression (radiation, bone density, etc.)
  if (progressionHook) {
    const startTime = state.metadata.startTime;
    progressionHook({
      agents: colonists, timeDelta, time, turn, startTime, rng: turnRng,
      yearsDelta, yearsSinceStart: unitsToYears(time - startTime, yearsPerUnit), yearsPerUnit,
      // The world the hook reads, as copies it cannot write through.
      metrics: Object.freeze(structuredClone(metrics)),
      environment: Object.freeze(structuredClone(state.environment ?? {})),
    });
  }

  // 2. Mortality — multi-cause. Each cause independently rolls and
  // attributes a specific reason of death, so the dashboard can break
  // down "8 deaths: 3 starvation, 2 radiation cancer, 2 accidents,
  // 1 suicide" instead of reporting a faceless total.
  const killColonist = (c: Agent, cause: string, description: string) => {
    if (!c.health.alive) return;
    const age = Math.floor(ageOf(c));
    c.health.alive = false;
    c.health.deathTime = time;
    c.health.deathCause = cause;
    c.narrative.lifeEvents.push({ time, event: `Died at age ${age} (${cause})`, source: 'kernel' });
    events.push({ turn, time, type: 'death', description: `${c.core.name}: ${description}`, agentId: c.core.id, cause });
  };

  // Every roll here draws from a stream of its own, keyed by the person,
  // the cause and the turn (SeededRng.forDraw), so two runs with the same
  // seed roll the same dice for the same person and one person's death
  // never moves another person's dice. A person dies in one run and not
  // the other only where that run's world gave them a higher hazard.
  const seed = state.metadata.seed;
  const roll = (c: Agent, cause: string) => SeededRng.forDraw(seed, turn, c.core.id, cause);
  for (const c of colonists) {
    if (!c.health.alive) continue;
    const exactAge = ageOf(c);
    // Whole years, for the descriptions.
    const age = Math.floor(exactAge);
    const h = causeHazards(c, metrics, exactAge, yearsDelta);

    // 2a. Natural mortality (age-dependent)
    if (roll(c, 'natural').chance(h.natural)) {
      const cause = exactAge >= 80 ? 'natural causes' : 'age-related complications';
      killColonist(c, cause, `died at age ${age} of ${cause}`);
      continue;
    }

    // 2b. Radiation cancer: an excess hazard that grows with the dose,
    // a distinct story from natural aging. Adults only.
    if (roll(c, 'radiation').chance(h.radiation)) {
      killColonist(c, 'radiation cancer',
        `died at age ${age} of radiation-induced cancer (cumulative ${Math.round(c.health.cumulativeRadiationMsv ?? 0)} mSv)`);
      continue;
    }

    // 2c. Starvation: a food reserve below a month puts everyone at risk;
    // the shortage is shared, not individual.
    if (roll(c, 'starvation').chance(h.starvation)) {
      killColonist(c, 'starvation',
        `died at age ${age} of starvation (food reserve ${(metrics.foodMonthsReserve as number).toFixed(1)} months)`);
      continue;
    }

    // 2d. Despair: a psych score under 0.2, weighted by emotionality.
    // Covered as a real phenomenon in long-duration isolation studies
    // (Antarctic, submarine crews, ISS).
    if (roll(c, 'despair').chance(h.despair)) {
      killColonist(c, 'despair',
        `died at age ${age} of prolonged psychological decline (psych ${c.health.psychScore.toFixed(2)})`);
      continue;
    }

    // 2e. Bone-density fracture: below 60 percent bone density a fall
    // can be fatal where medical capacity is low. From age 40.
    if (roll(c, 'fracture').chance(h.fracture)) {
      killColonist(c, 'fatal fracture',
        `died at age ${age} of a fall-induced fracture (bone density ${(c.health.boneDensityPct as number).toFixed(0)}%)`);
      continue;
    }

    // 2f. Baseline accident risk, weighted by department. A run with a
    // pressurized habitat (it carries that metric) has EVA and
    // life-support hazards; any other run has everyday ones.
    if (roll(c, 'accident').chance(h.accident)) {
      const descriptors = typeof metrics.pressurizedVolumeM3 === 'number'
        ? ['airlock failure', 'EVA accident', 'falling debris', 'pressure-suit tear', 'vehicle rollover']
        : ['equipment failure', 'vehicle accident', 'fall', 'electrical fault', 'workplace accident'];
      const descriptor = roll(c, 'accident-kind').pick(descriptors);
      const article = /^[aeiou]/i.test(descriptor) ? 'an' : 'a';
      killColonist(c, `accident: ${descriptor}`,
        `died at age ${age} in ${article} ${descriptor}`);
      continue;
    }
  }

  // 3a. Partnership formation — bridge between unpartnered adults with
  // compatible profiles. Without this, the only partnerships in the
  // sim are whatever the initial population generator seeded, and
  // every unpartnered colonist stays unpartnered for the whole run.
  // Compatibility is scored off HEXACO similarity (closer = higher
  // affinity) with a small Extraversion boost (extraverts initiate
  // more readily) and morale floor (low-morale colonies form fewer
  // relationships). Deterministic from seed.
  const unpartneredAdults = colonists.filter(c => c.health.alive
    && ageOf(c) >= 20
    && ageOf(c) <= 60
    && !c.social.partnerId);
  const partnerProb = metrics.morale > 0.35 ? 0.10 * yearsDelta : 0.03 * yearsDelta;
  for (let i = 0; i < unpartneredAdults.length; i++) {
    const a = unpartneredAdults[i];
    if (a.social.partnerId) continue;
    if (!turnRng.chance(partnerProb * (0.5 + a.hexaco.extraversion))) continue;
    // Pick a candidate: prefer HEXACO-compatible colonist of similar age
    const candidates = unpartneredAdults
      .filter(b => b.core.id !== a.core.id && !b.social.partnerId)
      .map(b => {
        const ageDelta = Math.abs(ageOf(a) - ageOf(b));
        const hexDistance = (['openness','conscientiousness','extraversion','agreeableness','emotionality','honestyHumility'] as const)
          .reduce((sum, k) => sum + Math.abs(a.hexaco[k] - b.hexaco[k]), 0) / 6;
        return { cell: b, affinity: (1 - hexDistance) * (1 - Math.min(1, ageDelta / 15)) };
      })
      .sort((x, y) => y.affinity - x.affinity);
    if (candidates.length === 0 || candidates[0].affinity < 0.4) continue;
    const b = candidates[0].cell;
    a.social.partnerId = b.core.id;
    b.social.partnerId = a.core.id;
    a.narrative.lifeEvents.push({ time, event: `Partnered with ${b.core.name}`, source: 'kernel' });
    b.narrative.lifeEvents.push({ time, event: `Partnered with ${a.core.name}`, source: 'kernel' });
    events.push({ turn, time, type: 'relationship', description: `${a.core.name} and ${b.core.name} formed a partnership`, agentId: a.core.id });
  }

  // 3b. Condition recovery — non-fatal injuries and illness should heal
  // over time unless they cascade. Light conditions clear on a roll;
  // severe ones linger. This prevents the conditions array from
  // accumulating indefinitely and gives colonists a path back from a
  // bad crisis turn.
  for (const c of colonists) {
    if (!c.health.alive) continue;
    if (!Array.isArray(c.health.conditions) || c.health.conditions.length === 0) continue;
    c.health.conditions = c.health.conditions.filter(cond => {
      const severe = /severe|chronic|cancer|permanent/i.test(cond);
      const recovered = turnRng.chance((severe ? 0.05 : 0.35) * yearsDelta);
      if (recovered) {
        c.narrative.lifeEvents.push({ time, event: `Recovered from ${cond}`, source: 'kernel' });
      }
      return !recovered;
    });
  }

  // 3c. Births — partnered couples first, then fall back to pairing
  // unpartnered-but-eligible adults. Partnerships meaningfully raise
  // birth probability; random pairings are a sparse background rate.
  const aliveAdults = colonists.filter(c => c.health.alive && ageOf(c) >= 20 && ageOf(c) <= 42);
  const partneredCouples: Array<[Agent, Agent]> = [];
  const seenPairs = new Set<string>();
  for (const a of aliveAdults) {
    if (a.social.childrenIds.length >= 3) continue;
    if (!a.social.partnerId) continue;
    if (seenPairs.has(a.core.id)) continue;
    const b = aliveAdults.find(x => x.core.id === a.social.partnerId && x.social.childrenIds.length < 3);
    if (!b) continue;
    seenPairs.add(a.core.id);
    seenPairs.add(b.core.id);
    partneredCouples.push([a, b]);
  }
  // A run that carries no food store (its scenario declares none) is not
  // short of food.
  const fedEnough = typeof metrics.foodMonthsReserve !== 'number' || metrics.foodMonthsReserve > 6;
  const baseBirthProb = metrics.morale > 0.4 && fedEnough ? 0.08 * yearsDelta : 0.02 * yearsDelta;
  // Partnered couples: 3x the base rate (stable relationships, higher
  // intentional birth decisions). Unpartnered pairs: 0.3x the base rate.
  const partneredBirthProb = Math.min(0.6, baseBirthProb * 3);
  const solitaryBirthProb = baseBirthProb * 0.3;
  const tryBirth = (p1: Agent, p2: Agent) => {
    // deterministic shared block below; inlined so both paths reuse the
    // same child-creation logic without duplicating the heavy literal.
    const childName = `${turnRng.pick(['Nova', 'Kai', 'Sol', 'Tera', 'Eos', 'Zan', 'Lyra', 'Orion', 'Vega', 'Juno', 'Atlas', 'Iris', 'Clio', 'Pax', 'Io', 'Thea'])} ${p1.core.name.split(' ').pop()}`;
    const childId = `col-born-${time}-${turnRng.int(1000, 9999)}`;
    const childHexaco: any = {};
    for (const trait of ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'emotionality', 'honestyHumility'] as const) {
      childHexaco[trait] = Math.max(0.05, Math.min(0.95,
        (p1.hexaco[trait] + p2.hexaco[trait]) / 2 + turnRng.next() * 0.1 - 0.05
      ));
    }
    const child: Agent = {
      // A roster with no science department counts the child with a parent's.
      core: { id: childId, name: childName, birthTime: time, marsborn: true, department: colonists.some(c => c.core.department === 'science') ? 'science' : p1.core.department, role: 'Child' },
      health: { alive: true, boneDensityPct: 88, cumulativeRadiationMsv: 0, psychScore: 0.9, conditions: [] },
      career: { specialization: 'Undetermined', yearsExperience: 0, rank: 'junior', achievements: ['Born here'] },
      social: { childrenIds: [], friendIds: [], earthContacts: 0 },
      narrative: { lifeEvents: [{ time, event: `Born to ${p1.core.name} and ${p2.core.name}`, source: 'kernel' }], featured: false },
      hexaco: childHexaco,
      hexacoHistory: [{ turn, time, hexaco: { ...childHexaco } }],
      memory: { shortTerm: [], longTerm: [], stances: {}, relationships: {} },
    };
    p1.social.childrenIds.push(childId);
    p2.social.childrenIds.push(childId);
    p1.narrative.lifeEvents.push({ time, event: `Child born: ${childName}`, source: 'kernel' });
    p2.narrative.lifeEvents.push({ time, event: `Child born: ${childName}`, source: 'kernel' });
    colonists.push(child);
    events.push({ turn, time, type: 'birth', description: `${childName} born to ${p1.core.name} and ${p2.core.name}`, agentId: childId });
  };
  // First: partnered couples
  for (const [p1, p2] of partneredCouples) {
    if (turnRng.chance(partneredBirthProb)) tryBirth(p1, p2);
  }
  // Then: unpartnered potential-parent pairs at a much lower rate
  const unpartneredPool = aliveAdults.filter(c => c.social.childrenIds.length < 3 && !seenPairs.has(c.core.id));
  for (let i = 0; i < unpartneredPool.length - 1; i += 2) {
    if (turnRng.chance(solitaryBirthProb)) {
      tryBirth(unpartneredPool[i], unpartneredPool[i + 1]);
    }
  }

  // 4. Career progression
  for (const c of colonists) {
    if (!c.health.alive) continue;
    const age = ageOf(c);

    // Children born in the run enter the workforce at 18, in a trade the
    // roster has; otherwise they stay in the department they were counted in.
    if (c.core.role === 'Child' && age >= 18) {
      const trade = turnRng.pick(['medical', 'engineering', 'agriculture', 'science'] as const);
      if (colonists.some(other => other.core.department === trade)) c.core.department = trade;
      c.career.specialization = turnRng.pick(['General', 'Support', 'Research']);
      c.core.role = `Junior ${c.career.specialization} Specialist`;
      c.career.rank = 'junior';
      c.narrative.lifeEvents.push({ time, event: `Began career in ${c.core.department}`, source: 'kernel' });
    }

    if (age < 18) continue;

    if (c.career.rank === 'junior' && c.career.yearsExperience >= 5 && turnRng.chance(0.15 * yearsDelta)) {
      c.career.rank = 'senior';
      c.narrative.lifeEvents.push({ time, event: `Promoted to Senior ${c.career.specialization}`, source: 'kernel' });
      events.push({ turn, time, type: 'promotion', description: `${c.core.name} promoted to senior`, agentId: c.core.id });
    }
    if (c.career.rank === 'senior' && c.career.yearsExperience >= 12 && turnRng.chance(0.08 * yearsDelta)) {
      c.career.rank = 'lead';
      c.narrative.lifeEvents.push({ time, event: `Promoted to Lead ${c.career.specialization}`, source: 'kernel' });
      events.push({ turn, time, type: 'promotion', description: `${c.core.name} promoted to lead`, agentId: c.core.id });
    }
  }

  // 5. Relationship-driven psych effects
  // Deaths cause grief in partners, children, and friends
  const deadThisTurn = new Set(events.filter(e => e.type === 'death' && e.agentId).map(e => e.agentId!));
  for (const c of colonists) {
    if (!c.health.alive) continue;

    // Partner died this turn: major psych hit
    if (c.social.partnerId && deadThisTurn.has(c.social.partnerId)) {
      c.health.psychScore = Math.max(0, c.health.psychScore - 0.25);
      c.narrative.lifeEvents.push({ time, event: `Partner died. Grief.`, source: 'kernel' });
      c.social.partnerId = undefined;
    }

    // Friend died: moderate psych hit
    const friendIds = c.social.friendIds || [];
    const deadFriends = friendIds.filter(id => deadThisTurn.has(id));
    if (deadFriends.length) {
      c.health.psychScore = Math.max(0, c.health.psychScore - 0.08 * deadFriends.length);
      c.social.friendIds = friendIds.filter(id => !deadThisTurn.has(id));
    }

    // Parent of dead child: devastating
    const childIds = c.social.childrenIds || [];
    const deadChildren = childIds.filter(id => deadThisTurn.has(id));
    if (deadChildren.length) {
      c.health.psychScore = Math.max(0, c.health.psychScore - 0.35);
      c.narrative.lifeEvents.push({ time, event: `Lost a child. Devastated.`, source: 'kernel' });
    }

    // The colony's mood reaches each person: morale above one half lifts
    // psych, below it wears psych down, 0.1 a year at the extremes.
    c.health.psychScore = Math.max(0, Math.min(1, c.health.psychScore + (metrics.morale - 0.5) * 0.1 * yearsDelta));

    // Having a partner provides a psych buffer
    if (c.social.partnerId) {
      c.health.psychScore = Math.min(1, c.health.psychScore + 0.02 * yearsDelta);
    }

    // Earth contacts provide comfort but decay over time
    if (c.social.earthContacts > 0) {
      c.health.psychScore = Math.min(1, c.health.psychScore + 0.01 * yearsDelta);
    }

    // Isolation penalty: no partner, no friends, no earth contacts
    if (!c.social.partnerId && (c.social.friendIds || []).length === 0 && c.social.earthContacts === 0) {
      c.health.psychScore = Math.max(0, c.health.psychScore - 0.04 * yearsDelta);
    }
  }

  // 5b. Form new relationships (partnerships and friendships)
  const singles = colonists.filter(c => c.health.alive && !c.social.partnerId && ageOf(c) >= 20);
  for (let i = 0; i < singles.length - 1; i += 2) {
    if (turnRng.chance(0.05 * yearsDelta)) {
      singles[i].social.partnerId = singles[i + 1].core.id;
      singles[i + 1].social.partnerId = singles[i].core.id;
      singles[i].narrative.lifeEvents.push({ time, event: `Partnered with ${singles[i + 1].core.name}`, source: 'kernel' });
      singles[i + 1].narrative.lifeEvents.push({ time, event: `Partnered with ${singles[i].core.name}`, source: 'kernel' });
      events.push({ turn, time, type: 'relationship', description: `${singles[i].core.name} and ${singles[i + 1].core.name} partnered`, agentId: singles[i].core.id });
    }
  }

  // 5c. Form friendships within departments
  const alive = colonists.filter(c => c.health.alive && (c.social.friendIds || []).length < 5);
  for (let i = 0; i < alive.length - 1; i++) {
    const a = alive[i], b = alive[i + 1];
    if (!a.social.friendIds) a.social.friendIds = [];
    if (!b.social.friendIds) b.social.friendIds = [];
    if (a.core.department === b.core.department && !a.social.friendIds.includes(b.core.id) && turnRng.chance(0.08 * yearsDelta)) {
      a.social.friendIds.push(b.core.id);
      b.social.friendIds.push(a.core.id);
    }
  }

  // 6. Morale drift (now informed by average psych scores)
  const aliveColonists = colonists.filter(c => c.health.alive);
  const avgPsych = aliveColonists.length ? aliveColonists.reduce((s, c) => s + c.health.psychScore, 0) / aliveColonists.length : 0.5;
  const psychPressure = avgPsych < 0.4 ? -0.06 : avgPsych > 0.7 ? 0.03 : 0;
  // Food and life support weigh on morale only in a run that carries them.
  const foodPressure = typeof metrics.foodMonthsReserve === 'number' && metrics.foodMonthsReserve < 6 ? -0.05 : 0;
  const popPressure = typeof metrics.lifeSupportCapacity === 'number' && aliveColonists.length > metrics.lifeSupportCapacity ? -0.08 : 0;
  const deathShock = deadThisTurn.size > 2 ? -0.04 * deadThisTurn.size : 0;
  metrics.morale = Math.max(0, Math.min(1, metrics.morale + (0.6 - metrics.morale) * 0.1 + foodPressure + popPressure + psychPressure + deathShock));

  // 7. Update population count
  metrics.population = aliveColonists.length;

  // 8. Resource production, for the resources the run carries. Food
  // grows with the modules a scenario declares; without them it only
  // runs down.
  if (typeof metrics.foodMonthsReserve === 'number') {
    const modules = typeof metrics.infrastructureModules === 'number' ? metrics.infrastructureModules : 0;
    metrics.foodMonthsReserve = Math.max(0, metrics.foodMonthsReserve - (yearsDelta * 0.5) + (modules * 0.3 * yearsDelta));
  }
  if (typeof metrics.scienceOutput === 'number') metrics.scienceOutput += yearsDelta;

  return {
    state: { ...state, agents: colonists, metrics, eventLog: [...state.eventLog, ...events] },
    events,
  };
}
