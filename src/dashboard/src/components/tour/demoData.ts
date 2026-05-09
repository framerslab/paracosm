/**
 * Pre-built demo simulation data representing 3 turns of a Mars Genesis run.
 * Used by the guided tour to populate the dashboard with realistic data
 * so users can see every component in action before running their own sim.
 *
 * Field shapes match exactly what EventCard, Badge, DivergenceRail, and
 * StatsBar expect. Structured outcomes enable proper badge rendering.
 */

import type { SimEvent } from '../../hooks/useSSE';

/**
 * Generate a small but visually-rich agent roster for a tour snapshot.
 * Picked to be just large enough that SwarmViz draws a recognizable
 * canvas (cells + glyphs + departments) without bloating the demo
 * bundle. Without these, useVizSnapshots returned empty arrays, maxTurn
 * stayed 0, and SwarmViz fell back to its empty-state placeholder ("Run
 * a simulation to see the colony visualization") — leaving the tour's
 * Viz step looking blank to first-time visitors.
 */
function buildDemoAgents(side: 'A' | 'B', turn: number): Array<Record<string, unknown>> {
  const departments = ['medical', 'engineering', 'agriculture', 'governance', 'science', 'logistics'];
  const ranks = ['junior', 'senior', 'lead', 'chief'] as const;
  const moods = ['neutral', 'optimistic', 'tense', 'focused', 'anxious', 'confident'];
  const firstA = ['Aria', 'Diego', 'Yuki', 'Kira', 'Marco', 'Lila', 'Theo', 'Nia', 'Omar', 'Saanvi', 'Felix', 'Mira'];
  const firstB = ['Ren', 'Iris', 'Kenji', 'Anya', 'Tomas', 'Zara', 'Vinh', 'Lena', 'Hugo', 'Priya', 'Jonah', 'Mei'];
  const lastA = ['Vasquez', 'Park', 'Okafor', 'Reyes', 'Singh', 'Cohen', 'Mwangi', 'Roy', 'Tate', 'Lopez', 'Bauer', 'Akin'];
  const lastB = ['Tanaka', 'Brandt', 'Kim', 'Nilsson', 'Diaz', 'Patel', 'Foley', 'Volkov', 'Cruz', 'Hossain', 'Mukherjee', 'Park'];
  const firstNames = side === 'A' ? firstA : firstB;
  const lastNames = side === 'A' ? lastA : lastB;
  return Array.from({ length: 14 }, (_, i) => {
    const aliveBias = ((i * 7 + turn * 3) % 13) > 1; // most alive, a few not
    return {
      agentId: `${side.toLowerCase()}-${i}`,
      name: `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`,
      department: departments[i % departments.length],
      role: i === 0 ? 'Department Head' : (ranks[(i + turn) % ranks.length] === 'lead' ? 'Senior Specialist' : 'Specialist'),
      rank: ranks[(i + turn) % ranks.length],
      alive: aliveBias,
      marsborn: i % 5 === 0,
      psychScore: 0.55 + ((i * 11 + turn * 7) % 35) / 100,
      age: 28 + ((i * 3 + turn) % 22),
      generation: i % 5 === 0 ? 1 : 0,
      childrenIds: i % 6 === 2 ? [`${side.toLowerCase()}-${(i + 7) % 14}`] : [],
      featured: i < 3,
      mood: moods[(i + turn) % moods.length],
      shortTermMemory: [`Turn ${turn}: working on department duties`],
    };
  });
}

const DEMO_SNAPSHOTS: SimEvent[] = [1, 2, 3].flatMap(turn => [
  {
    type: 'systems_snapshot',
    leader: 'Commander Elena Vasquez',
    data: {
      turn, time: 2034 + turn,
      agents: buildDemoAgents('A', turn),
      population: 100, morale: 0.85 + turn * 0.01, foodReserve: 18 - turn * 0.5,
      births: turn === 2 ? 1 : 0, deaths: turn === 3 ? 1 : 0,
    },
  } as SimEvent,
  {
    type: 'systems_snapshot',
    leader: 'Commander Hiroshi Tanaka',
    data: {
      turn, time: 2034 + turn,
      agents: buildDemoAgents('B', turn),
      population: 100, morale: 0.88 + turn * 0.005, foodReserve: 18 - turn * 0.3,
      births: turn === 3 ? 1 : 0, deaths: 0,
    },
  } as SimEvent,
]);

export const DEMO_EVENTS: SimEvent[] = [
  // ── Status: initialize the simulation ──────────────────────────────
  {
    type: 'status',
    leader: '',
    data: {
      phase: 'parallel',
      maxTurns: 6,
      actors: [
        {
          name: 'Commander Elena Vasquez',
          archetype: 'The Visionary',
          unit: 'Olympus Base',
          hexaco: { openness: 0.92, conscientiousness: 0.40, extraversion: 0.80, agreeableness: 0.55, emotionality: 0.25, honestyHumility: 0.65 },
          instructions: 'You lead by inspiration. You value openness to experience and bold experimentation. You tolerate mess if it leads to breakthroughs.',
          quote: 'The frontier rewards the bold.',
        },
        {
          name: 'Commander Hiroshi Tanaka',
          archetype: 'The Engineer',
          unit: 'Meridian Station',
          hexaco: { openness: 0.30, conscientiousness: 0.95, extraversion: 0.35, agreeableness: 0.70, emotionality: 0.60, honestyHumility: 0.90 },
          instructions: 'You lead by precision and evidence. You value conscientiousness and proven methods. You reject untested approaches.',
          quote: 'Every system has a tolerance. Know yours.',
        },
      ],
    },
  },

  // ════════════════════════════════════════════════════════════════════
  // TURN 1 — LEADER A
  // ════════════════════════════════════════════════════════════════════
  {
    type: 'turn_start',
    leader: 'Commander Elena Vasquez',
    data: {
      turn: 1, time: 2035,
      title: 'Dust Storm Season Begins',
      crisis: 'A massive dust storm system approaching from the Hellas basin threatens solar panel efficiency and outdoor operations for the next several months.',
      category: 'environmental', emergent: false,
      turnSummary: 'The colony faces its first major environmental challenge as Martian dust storm season arrives early.',
      metrics: { population: 100, morale: 0.85, foodMonthsReserve: 18, waterLitersPerDay: 800, powerKw: 400, infrastructureModules: 3, lifeSupportCapacity: 120, scienceOutput: 0 },
    },
  },
  { type: 'specialist_start', leader: 'Commander Elena Vasquez', data: { turn: 1, department: 'engineering', title: 'Engineering Analysis' } },
  {
    type: 'specialist_done', leader: 'Commander Elena Vasquez',
    data: {
      turn: 1, department: 'engineering',
      summary: 'Solar panel output will drop 40-60% during peak storm activity. Recommend deploying dust mitigation shields and switching to nuclear backup.',
      forgedTools: [{ name: 'dust_accumulation_model', description: 'Predicts dust buildup rate on solar arrays given wind speed and particle density', approved: true, confidence: 0.91, mode: 'computational' }],
      citations: 2, citationList: [{ text: 'Mars dust storm optical depth models', url: 'https://doi.org/10.1029/2019JE006102' }],
    },
  },
  { type: 'specialist_start', leader: 'Commander Elena Vasquez', data: { turn: 1, department: 'medical', title: 'Medical Analysis' } },
  {
    type: 'specialist_done', leader: 'Commander Elena Vasquez',
    data: {
      turn: 1, department: 'medical',
      summary: 'Dust infiltration poses respiratory risks. Recommend enhanced air filtration and limiting EVA exposure to 2 hours per rotation.',
      forgedTools: [], citations: 1,
    },
  },
  { type: 'decision_pending', leader: 'Commander Elena Vasquez', data: { turn: 1 } },
  {
    type: 'decision_made', leader: 'Commander Elena Vasquez',
    data: {
      turn: 1,
      decision: 'Aggressive expansion despite the storm. Deploy experimental dust-repelling coatings on all solar arrays and authorize overtime shifts to complete the greenhouse dome before storm peak.',
      rationale: 'The storm is a forcing function. If we can maintain power through it, we prove self-sufficiency months ahead of schedule.',
      selectedPolicies: ['expand_solar', 'mandatory_overtime'],
    },
  },
  {
    type: 'outcome', leader: 'Commander Elena Vasquez',
    data: {
      turn: 1,
      outcome: 'risky_success',
      _decision: 'Aggressive expansion despite the storm. Deploy experimental dust-repelling coatings on all solar arrays and authorize overtime shifts to complete the greenhouse dome before storm peak.',
      _rationale: 'The storm is a forcing function. If we can maintain power through it, we prove self-sufficiency months ahead of schedule.',
      _policies: ['expand_solar', 'mandatory_overtime'],
      _toolCount: 1, _citeCount: 3,
    },
  },
  {
    type: 'agent_reactions', leader: 'Commander Elena Vasquez',
    data: {
      turn: 1,
      totalReactions: 14,
      reactions: [
        { name: 'Erik Lindqvist', role: 'Chief Engineer', department: 'engineering', mood: 'anxious', quote: 'The coatings are untested at scale. One failure cascade and we lose the entire west array.', hexaco: { O: 0.45, C: 0.88, E: 0.35, A: 0.62, Em: 0.55, HH: 0.80 }, boneDensity: 94, radiation: 12, psychScore: 72, intensity: 0.78 },
        { name: 'Dr. Yuki Tanaka', role: 'Chief Medical Officer', department: 'medical', mood: 'negative', quote: 'Overtime orders during a dust event. She is trading long-term health for short-term gains.', hexaco: { O: 0.60, C: 0.75, E: 0.50, A: 0.80, Em: 0.70, HH: 0.85 }, boneDensity: 96, radiation: 8, psychScore: 68, intensity: 0.82 },
      ],
    },
  },
  {
    type: 'bulletin', leader: 'Commander Elena Vasquez',
    data: {
      turn: 1,
      posts: [
        { name: 'Colony Bulletin', role: 'Official', department: 'governance', post: 'Commander Vasquez orders experimental dust coatings deployed on all solar infrastructure. Engineering crews working double shifts to beat the storm peak.', mood: 'anxious', likes: 18, replies: 7 },
      ],
    },
  },
  {
    type: 'turn_done', leader: 'Commander Elena Vasquez',
    data: { turn: 1, metrics: { population: 100, morale: 0.78, foodMonthsReserve: 17.5, waterLitersPerDay: 790, powerKw: 340, infrastructureModules: 3, lifeSupportCapacity: 120, scienceOutput: 2 } },
  },

  // ════════════════════════════════════════════════════════════════════
  // TURN 1 — LEADER B
  // ════════════════════════════════════════════════════════════════════
  {
    type: 'turn_start',
    leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 1, time: 2035,
      title: 'Dust Storm Season Begins',
      crisis: 'A massive dust storm system approaching from the Hellas basin threatens solar panel efficiency and outdoor operations for the next several months.',
      category: 'environmental', emergent: false,
      turnSummary: 'The colony faces its first major environmental challenge as Martian dust storm season arrives early.',
      metrics: { population: 100, morale: 0.85, foodMonthsReserve: 18, waterLitersPerDay: 800, powerKw: 400, infrastructureModules: 3, lifeSupportCapacity: 120, scienceOutput: 0 },
    },
  },
  { type: 'specialist_start', leader: 'Commander Hiroshi Tanaka', data: { turn: 1, department: 'engineering', title: 'Engineering Analysis' } },
  {
    type: 'specialist_done', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 1, department: 'engineering',
      summary: 'Recommend immediate power conservation protocols. Reroute non-essential systems to standby. Reinforce habitat seals against dust infiltration.',
      forgedTools: [{ name: 'power_budget_optimizer', description: 'Linear program that allocates limited kW across departments by priority weight', approved: true, confidence: 0.94, mode: 'optimization' }],
      citations: 3,
    },
  },
  { type: 'specialist_start', leader: 'Commander Hiroshi Tanaka', data: { turn: 1, department: 'agriculture', title: 'Agriculture Analysis' } },
  {
    type: 'specialist_done', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 1, department: 'agriculture',
      summary: 'Reduced solar means reduced grow light hours. Recommend switching to cold-tolerant crop rotation and prioritizing calorie-dense varieties.',
      forgedTools: [], citations: 1,
    },
  },
  { type: 'decision_pending', leader: 'Commander Hiroshi Tanaka', data: { turn: 1 } },
  {
    type: 'decision_made', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 1,
      decision: 'Full conservation mode. Reduce non-essential power by 40%, halt all outdoor construction, mandate indoor rest periods. Protect what we have.',
      rationale: 'We cannot risk infrastructure damage from an untested storm. Conservation preserves our margin of safety until conditions improve.',
      selectedPolicies: ['power_conservation', 'construction_halt', 'indoor_mandate'],
    },
  },
  {
    type: 'outcome', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 1,
      outcome: 'conservative_success',
      _decision: 'Full conservation mode. Reduce non-essential power by 40%, halt all outdoor construction, mandate indoor rest periods. Protect what we have.',
      _rationale: 'We cannot risk infrastructure damage from an untested storm. Conservation preserves our margin of safety until conditions improve.',
      _policies: ['power_conservation', 'construction_halt', 'indoor_mandate'],
      _toolCount: 1, _citeCount: 4,
    },
  },
  {
    type: 'agent_reactions', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 1,
      totalReactions: 14,
      reactions: [
        { name: 'Carlos Fernandez', role: 'Chief Scientist', department: 'science', mood: 'resigned', quote: 'Another month of no fieldwork. The regolith samples are degrading in storage.', hexaco: { O: 0.82, C: 0.60, E: 0.55, A: 0.50, Em: 0.40, HH: 0.70 }, boneDensity: 91, radiation: 18, psychScore: 65, intensity: 0.60 },
        { name: 'Amara Osei', role: 'Head of Agriculture', department: 'agriculture', mood: 'positive', quote: 'Good call on the crop rotation. The cold-tolerant strains are actually yielding better than expected.', hexaco: { O: 0.55, C: 0.78, E: 0.65, A: 0.85, Em: 0.50, HH: 0.75 }, boneDensity: 97, radiation: 6, psychScore: 82, intensity: 0.55 },
      ],
    },
  },
  {
    type: 'bulletin', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 1,
      posts: [
        { name: 'Colony Bulletin', role: 'Official', department: 'governance', post: 'Commander Tanaka activates full conservation protocols as dust storm approaches. All outdoor operations suspended. Power reserves at 95%.', mood: 'neutral', likes: 31, replies: 4 },
      ],
    },
  },
  {
    type: 'turn_done', leader: 'Commander Hiroshi Tanaka',
    data: { turn: 1, metrics: { population: 100, morale: 0.87, foodMonthsReserve: 17.8, waterLitersPerDay: 800, powerKw: 395, infrastructureModules: 3, lifeSupportCapacity: 120, scienceOutput: 0 } },
  },

  // ════════════════════════════════════════════════════════════════════
  // TURN 2 — LEADER A
  // ════════════════════════════════════════════════════════════════════
  {
    type: 'turn_start',
    leader: 'Commander Elena Vasquez',
    data: {
      turn: 2, time: 2036,
      title: 'Water Recycler Contamination',
      crisis: 'Trace perchlorate contamination detected in the primary water recycling system. Secondary filters are catching it but operating at 150% rated capacity.',
      category: 'infrastructure', emergent: true,
      turnSummary: 'An emergent crisis triggered by dust storm operations. Aggressive EVA schedules allowed fine regolith into intake systems.',
      metrics: { population: 100, morale: 0.78, foodMonthsReserve: 17, waterLitersPerDay: 650, powerKw: 360, infrastructureModules: 3, lifeSupportCapacity: 118, scienceOutput: 4 },
    },
  },
  { type: 'specialist_start', leader: 'Commander Elena Vasquez', data: { turn: 2, department: 'engineering', title: 'Engineering Analysis' } },
  {
    type: 'specialist_done', leader: 'Commander Elena Vasquez',
    data: {
      turn: 2, department: 'engineering',
      summary: 'Primary recycler needs full teardown and decontamination (48 hours). Can run on secondary alone but strict rationing required.',
      forgedTools: [
        { name: 'perchlorate_diffusion_simulator', description: 'Models contamination spread through water system piping under various flow rates', approved: true, confidence: 0.88, mode: 'simulation' },
        { name: 'filter_lifespan_predictor', description: 'Estimates remaining hours on secondary filters given contamination load', approved: true, confidence: 0.92, mode: 'predictive' },
      ],
      citations: 4,
    },
  },
  { type: 'specialist_start', leader: 'Commander Elena Vasquez', data: { turn: 2, department: 'medical', title: 'Medical Analysis' } },
  {
    type: 'specialist_done', leader: 'Commander Elena Vasquez',
    data: {
      turn: 2, department: 'medical',
      summary: 'Perchlorate exposure at detected levels causes thyroid disruption over weeks. Recommend immediate blood panels and potassium iodide supplements.',
      forgedTools: [], citations: 2,
    },
  },
  { type: 'decision_pending', leader: 'Commander Elena Vasquez', data: { turn: 2 } },
  {
    type: 'decision_made', leader: 'Commander Elena Vasquez',
    data: {
      turn: 2,
      decision: 'Dual-track: run decontamination AND begin drilling a new emergency well. Redirect science team to water prospecting. We solve this permanently.',
      rationale: 'Patching the recycler buys time but does not fix the underlying vulnerability. A second independent water source eliminates single-point failure.',
      selectedPolicies: ['emergency_drilling', 'science_redirect'],
    },
  },
  {
    type: 'outcome', leader: 'Commander Elena Vasquez',
    data: {
      turn: 2,
      outcome: 'risky_success',
      _decision: 'Dual-track: run decontamination AND begin drilling a new emergency well. Redirect science team to water prospecting. We solve this permanently.',
      _rationale: 'Patching the recycler buys time but does not fix the underlying vulnerability. A second independent water source eliminates single-point failure.',
      _policies: ['emergency_drilling', 'science_redirect'],
      _toolCount: 2, _citeCount: 6,
      deaths: 2,
    },
  },
  {
    type: 'agent_reactions', leader: 'Commander Elena Vasquez',
    data: {
      turn: 2,
      totalReactions: 14,
      reactions: [
        { name: 'Dr. Yuki Tanaka', role: 'Chief Medical Officer', department: 'medical', mood: 'negative', quote: 'Two people died during rationing. The well could have waited until the recycler was fixed.', hexaco: { O: 0.60, C: 0.75, E: 0.50, A: 0.80, Em: 0.72, HH: 0.85 }, boneDensity: 96, radiation: 10, psychScore: 58, intensity: 0.91 },
        { name: 'Carlos Fernandez', role: 'Chief Scientist', department: 'science', mood: 'positive', quote: 'The subsurface ice discovery changes everything. This is publishable. The colony is sitting on a water reservoir.', hexaco: { O: 0.85, C: 0.60, E: 0.58, A: 0.50, Em: 0.38, HH: 0.70 }, boneDensity: 91, radiation: 20, psychScore: 70, intensity: 0.74 },
      ],
    },
  },
  {
    type: 'bulletin', leader: 'Commander Elena Vasquez',
    data: {
      turn: 2,
      posts: [
        { name: 'Colony Bulletin', role: 'Official', department: 'governance', post: 'Emergency drilling operation discovers subsurface ice at 12m depth. Two colonists lost during water rationing period. Commander Vasquez: "Investing in survival."', mood: 'negative', likes: 42, replies: 19 },
      ],
    },
  },
  {
    type: 'turn_done', leader: 'Commander Elena Vasquez',
    data: { turn: 2, metrics: { population: 98, morale: 0.68, foodMonthsReserve: 16, waterLitersPerDay: 850, powerKw: 350, infrastructureModules: 4, lifeSupportCapacity: 116, scienceOutput: 8 }, deaths: 2 },
  },

  // ════════════════════════════════════════════════════════════════════
  // TURN 2 — LEADER B
  // ════════════════════════════════════════════════════════════════════
  {
    type: 'turn_start',
    leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 2, time: 2036,
      title: 'Water Recycler Contamination',
      crisis: 'Trace perchlorate contamination detected in the primary water recycling system. Secondary filters are catching it but operating at 150% rated capacity.',
      category: 'infrastructure', emergent: true,
      turnSummary: 'An emergent crisis triggered by dust storm residue in the atmosphere settling into intake vents during routine maintenance.',
      metrics: { population: 100, morale: 0.87, foodMonthsReserve: 17.5, waterLitersPerDay: 650, powerKw: 390, infrastructureModules: 3, lifeSupportCapacity: 120, scienceOutput: 0 },
    },
  },
  { type: 'specialist_start', leader: 'Commander Hiroshi Tanaka', data: { turn: 2, department: 'engineering', title: 'Engineering Analysis' } },
  {
    type: 'specialist_done', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 2, department: 'engineering',
      summary: 'Recommend isolating contaminated section, flushing the primary system, and installing redundant pre-filters before bringing it back online.',
      forgedTools: [{ name: 'water_quality_monitor', description: 'Continuous perchlorate level tracker with alert thresholds per pipe segment', approved: true, confidence: 0.96, mode: 'monitoring' }],
      citations: 2,
    },
  },
  { type: 'decision_pending', leader: 'Commander Hiroshi Tanaka', data: { turn: 2 } },
  {
    type: 'decision_made', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 2,
      decision: 'Methodical decontamination. Isolate affected pipes, flush system section by section, install triple-redundant filtration. Strict water rationing at 80% normal allocation. No shortcuts.',
      rationale: 'A contaminated water supply is an existential threat. We fix this properly, verify every section, and prevent recurrence.',
      selectedPolicies: ['water_rationing', 'system_overhaul'],
    },
  },
  {
    type: 'outcome', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 2,
      outcome: 'conservative_success',
      _decision: 'Methodical decontamination. Isolate affected pipes, flush system section by section, install triple-redundant filtration. Strict water rationing at 80% normal allocation. No shortcuts.',
      _rationale: 'A contaminated water supply is an existential threat. We fix this properly, verify every section, and prevent recurrence.',
      _policies: ['water_rationing', 'system_overhaul'],
      _toolCount: 1, _citeCount: 2,
    },
  },
  {
    type: 'agent_reactions', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 2,
      totalReactions: 14,
      reactions: [
        { name: 'James Mueller', role: 'Chief Engineer', department: 'engineering', mood: 'positive', quote: 'The triple-redundant design is elegant. We should have built it this way from the start.', hexaco: { O: 0.40, C: 0.92, E: 0.30, A: 0.65, Em: 0.45, HH: 0.88 }, boneDensity: 92, radiation: 15, psychScore: 78, intensity: 0.65 },
        { name: 'Dr. Priya Singh', role: 'Colony Psychologist', department: 'psychology', mood: 'positive', quote: 'Morale is solid. People trust the process. They feel safe.', hexaco: { O: 0.70, C: 0.68, E: 0.72, A: 0.90, Em: 0.65, HH: 0.82 }, boneDensity: 98, radiation: 5, psychScore: 88, intensity: 0.50 },
      ],
    },
  },
  {
    type: 'bulletin', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 2,
      posts: [
        { name: 'Colony Bulletin', role: 'Official', department: 'governance', post: 'Commander Tanaka completes 72-hour decontamination. Water purity above baseline. Zero casualties. New triple-filter system installed.', mood: 'positive', likes: 47, replies: 6 },
      ],
    },
  },
  {
    type: 'turn_done', leader: 'Commander Hiroshi Tanaka',
    data: { turn: 2, metrics: { population: 100, morale: 0.89, foodMonthsReserve: 17, waterLitersPerDay: 820, powerKw: 388, infrastructureModules: 3, lifeSupportCapacity: 120, scienceOutput: 1 } },
  },

  // ════════════════════════════════════════════════════════════════════
  // TURN 3 — LEADER A
  // ════════════════════════════════════════════════════════════════════
  {
    type: 'turn_start',
    leader: 'Commander Elena Vasquez',
    data: {
      turn: 3, time: 2037,
      title: 'First Marsborn Generation',
      crisis: 'Three colonists are pregnant. Colony must decide on birthing protocols, education infrastructure, and whether to allocate scarce resources to a pediatric wing.',
      category: 'social', emergent: true,
      turnSummary: 'A milestone moment as the colony prepares for its first generation of humans born on Mars.',
      metrics: { population: 98, morale: 0.72, foodMonthsReserve: 15, waterLitersPerDay: 850, powerKw: 370, infrastructureModules: 4, lifeSupportCapacity: 116, scienceOutput: 12 },
    },
  },
  { type: 'specialist_start', leader: 'Commander Elena Vasquez', data: { turn: 3, department: 'medical', title: 'Medical Analysis' } },
  {
    type: 'specialist_done', leader: 'Commander Elena Vasquez',
    data: {
      turn: 3, department: 'medical',
      summary: 'Martian gravity (0.38g) effects on fetal development are unknown. Recommend centrifuge-assisted birthing suite and continuous monitoring.',
      forgedTools: [{ name: 'low_gravity_gestation_model', description: 'Simulates bone and organ development trajectories under Mars gravity with centrifuge augmentation', approved: true, confidence: 0.85, mode: 'biomedical' }],
      citations: 5,
    },
  },
  { type: 'specialist_start', leader: 'Commander Elena Vasquez', data: { turn: 3, department: 'psychology', title: 'Psychology Analysis' } },
  {
    type: 'specialist_done', leader: 'Commander Elena Vasquez',
    data: {
      turn: 3, department: 'psychology',
      summary: 'Colony morale surging. First births represent hope and permanence. Recommend public celebration and naming ceremony.',
      forgedTools: [], citations: 1,
    },
  },
  { type: 'decision_pending', leader: 'Commander Elena Vasquez', data: { turn: 3 } },
  {
    type: 'decision_made', leader: 'Commander Elena Vasquez',
    data: {
      turn: 3,
      decision: 'Full commitment. Convert Module 4 into a dedicated pediatric and education wing. Authorize the centrifuge birthing suite. Declare "Founding Day" as a colony holiday.',
      rationale: 'These children ARE the mission. If Mars cannot sustain the next generation, nothing else matters.',
      selectedPolicies: ['pediatric_wing', 'founding_day', 'centrifuge_birth'],
    },
  },
  {
    type: 'outcome', leader: 'Commander Elena Vasquez',
    data: {
      turn: 3,
      outcome: 'risky_success',
      _decision: 'Full commitment. Convert Module 4 into a dedicated pediatric and education wing. Authorize the centrifuge birthing suite. Declare "Founding Day" as a colony holiday.',
      _rationale: 'These children ARE the mission. If Mars cannot sustain the next generation, nothing else matters.',
      _policies: ['pediatric_wing', 'founding_day', 'centrifuge_birth'],
      _toolCount: 1, _citeCount: 6,
    },
  },
  {
    type: 'agent_reactions', leader: 'Commander Elena Vasquez',
    data: {
      turn: 3,
      totalReactions: 14,
      reactions: [
        { name: 'Dr. Yuki Tanaka', role: 'Chief Medical Officer', department: 'medical', mood: 'hopeful', quote: 'For the first time I feel like we are building something permanent. The centrifuge data is remarkable.', hexaco: { O: 0.62, C: 0.75, E: 0.52, A: 0.80, Em: 0.68, HH: 0.85 }, boneDensity: 95, radiation: 12, psychScore: 74, intensity: 0.70 },
        { name: 'Erik Lindqvist', role: 'Chief Engineer', department: 'engineering', mood: 'positive', quote: 'Module 4 conversion is aggressive but doable. First time I have seen people volunteer for extra shifts.', hexaco: { O: 0.46, C: 0.88, E: 0.36, A: 0.63, Em: 0.52, HH: 0.80 }, boneDensity: 93, radiation: 14, psychScore: 76, intensity: 0.62 },
      ],
    },
  },
  {
    type: 'bulletin', leader: 'Commander Elena Vasquez',
    data: {
      turn: 3,
      posts: [
        { name: 'Colony Bulletin', role: 'Official', department: 'governance', post: 'Three pregnancies confirmed. Commander Vasquez commits to full pediatric infrastructure and declares Founding Day. "These children ARE the mission."', mood: 'hopeful', likes: 63, replies: 22 },
      ],
    },
  },
  {
    type: 'turn_done', leader: 'Commander Elena Vasquez',
    data: { turn: 3, metrics: { population: 98, morale: 0.82, foodMonthsReserve: 14, waterLitersPerDay: 840, powerKw: 365, infrastructureModules: 4, lifeSupportCapacity: 114, scienceOutput: 16 } },
  },

  // ════════════════════════════════════════════════════════════════════
  // TURN 3 — LEADER B
  // ════════════════════════════════════════════════════════════════════
  {
    type: 'turn_start',
    leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 3, time: 2037,
      title: 'First Marsborn Generation',
      crisis: 'Three colonists are pregnant. Colony must decide on birthing protocols, education infrastructure, and whether to allocate scarce resources to a pediatric wing.',
      category: 'social', emergent: true,
      turnSummary: 'A milestone moment as the colony prepares for its first generation of humans born on Mars.',
      metrics: { population: 100, morale: 0.89, foodMonthsReserve: 16.5, waterLitersPerDay: 820, powerKw: 385, infrastructureModules: 3, lifeSupportCapacity: 120, scienceOutput: 2 },
    },
  },
  { type: 'specialist_start', leader: 'Commander Hiroshi Tanaka', data: { turn: 3, department: 'medical', title: 'Medical Analysis' } },
  {
    type: 'specialist_done', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 3, department: 'medical',
      summary: 'Insufficient data on low-gravity pregnancies. Recommend Earth-normal protocols adapted for Mars with extensive monitoring. No experimental interventions without peer review.',
      forgedTools: [{ name: 'prenatal_risk_matrix', description: 'Weighted risk assessment combining gravity, radiation, nutrition, and psychological factors for each trimester', approved: true, confidence: 0.93, mode: 'clinical' }],
      citations: 6,
    },
  },
  { type: 'decision_pending', leader: 'Commander Hiroshi Tanaka', data: { turn: 3 } },
  {
    type: 'decision_made', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 3,
      decision: 'Measured approach. Dedicate existing medical bay expansion to maternal care. No experimental centrifuge. Follow Earth-standard protocols with enhanced monitoring.',
      rationale: 'Untested interventions on pregnant colonists are unacceptable. We use proven medical science.',
      selectedPolicies: ['medical_expansion', 'standard_protocols', 'enhanced_monitoring'],
    },
  },
  {
    type: 'outcome', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 3,
      outcome: 'conservative_success',
      _decision: 'Measured approach. Dedicate existing medical bay expansion to maternal care. No experimental centrifuge. Follow Earth-standard protocols with enhanced monitoring.',
      _rationale: 'Untested interventions on pregnant colonists are unacceptable. We use proven medical science.',
      _policies: ['medical_expansion', 'standard_protocols', 'enhanced_monitoring'],
      _toolCount: 1, _citeCount: 6,
    },
  },
  {
    type: 'agent_reactions', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 3,
      totalReactions: 14,
      reactions: [
        { name: 'Dr. Sarah Anderson', role: 'Chief Medical Officer', department: 'medical', mood: 'positive', quote: 'The right call. Every medical textbook says proven protocols first. We can innovate after we have data from healthy births.', hexaco: { O: 0.50, C: 0.82, E: 0.45, A: 0.75, Em: 0.60, HH: 0.90 }, boneDensity: 95, radiation: 9, psychScore: 84, intensity: 0.55 },
        { name: 'Dr. Priya Singh', role: 'Colony Psychologist', department: 'psychology', mood: 'positive', quote: 'The quiet confidence is working. People feel cared for without feeling like test subjects.', hexaco: { O: 0.70, C: 0.68, E: 0.72, A: 0.90, Em: 0.62, HH: 0.82 }, boneDensity: 98, radiation: 5, psychScore: 90, intensity: 0.48 },
      ],
    },
  },
  {
    type: 'bulletin', leader: 'Commander Hiroshi Tanaka',
    data: {
      turn: 3,
      posts: [
        { name: 'Colony Bulletin', role: 'Official', department: 'governance', post: 'Medical bay expansion underway for maternal care. Commander Tanaka rejects experimental centrifuge in favor of proven Earth protocols. "We trust the science we know."', mood: 'positive', likes: 38, replies: 5 },
      ],
    },
  },
  {
    type: 'turn_done', leader: 'Commander Hiroshi Tanaka',
    data: { turn: 3, metrics: { population: 100, morale: 0.90, foodMonthsReserve: 16, waterLitersPerDay: 815, powerKw: 382, infrastructureModules: 3, lifeSupportCapacity: 120, scienceOutput: 3 } },
  },
  // systems_snapshot events feed SwarmViz's living-canvas. Without
  // these, the Viz step of the tour shows only the empty placeholder.
  ...DEMO_SNAPSHOTS,
];
