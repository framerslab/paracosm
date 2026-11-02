import { useState, useEffect } from 'react';
import { subscribeScenarioUpdates } from '../scenario-sync';

export interface ScenarioClientPayload {
  id: string;
  /** Optional permalink to the scenario JSON in the public repo.
   *  Surfaced on the SettingsPanel as a "View scenario JSON on GitHub"
   *  link so users can read or fork the scenario source. */
  sourceUrl?: string;
  version: string;
  labels: {
    name: string;
    shortName: string;
    populationNoun: string;
    settlementNoun: string;
    currency: string;
    eventNoun?: string;
    eventNounSingular?: string;
    /** Singular display word for the swappable decision-making entity
     *  (the type the Compare view's bundles run in parallel). Default
     *  "actor"; specialized per-scenario in compiled drafts. */
    actorNoun?: string;
    /** Plural form of `actorNoun`. Default "actors". */
    actorNounPlural?: string;
    /** Optional 1-2 sentence "what is this scenario about" copy
     *  surfaced on the LoadedScenarioCTA. <=200 chars, plain prose. */
    tagline?: string;
  };
  theme: {
    primaryColor: string;
    accentColor: string;
  };
  setup: {
    defaultTurns: number;
    defaultSeed: number;
    defaultStartTime: number;
    defaultTimePerTurn?: number;
    defaultPopulation: number;
  };
  departments: Array<{
    id: string;
    label: string;
    role: string;
    icon: string;
  }>;
  presets: Array<{
    id: string;
    label: string;
    /** Engine-side ScenarioPreset uses `leaders`. Server's
     *  projectScenarioForClient passes presets through unchanged, so
     *  the dashboard receives `leaders`, not `actors`. The legacy
     *  `actors` alias is preserved as optional so older code paths
     *  that expected it still typecheck while we migrate. */
    leaders?: Array<{ name: string; archetype: string; unit?: string; hexaco: Record<string, number>; instructions: string }>;
    actors?: Array<{ name: string; archetype: string; unit?: string; hexaco: Record<string, number>; instructions: string }>;
    personnel?: Array<{ name: string; department: string; role: string; specialization: string; age: number; featured: boolean }>;
  }>;
  ui: {
    /** `max` and `initial` are the world field's: a percent metric held on
     *  0 to 1 declares max 1, one held on 0 to 100 declares max 100. */
    headerMetrics: Array<{ id: string; format: string; max?: number; initial?: number }>;
    tooltipFields: string[];
    reportSections: Array<'crisis' | 'departments' | 'decision' | 'outcome' | 'quotes' | 'causality'>;
    departmentIcons: Record<string, string>;
    setupSections: string[];
  };
  policies: {
    toolForging: boolean;
    bulletin: boolean;
    characterChat: boolean;
  };
}

const MARS_FALLBACK: ScenarioClientPayload = {
  id: 'mars-genesis',
  version: '3.0.0',
  labels: { name: 'Mars Genesis', shortName: 'mars', populationNoun: 'colonists', settlementNoun: 'colony', currency: 'credits' },
  theme: { primaryColor: '#dc2626', accentColor: '#f97316' },
  setup: { defaultTurns: 6, defaultSeed: 950, defaultStartTime: 2035, defaultTimePerTurn: 8, defaultPopulation: 100 },
  departments: [
    { id: 'medical', label: 'Medical', role: 'Chief Medical Officer', icon: '🏥' },
    { id: 'engineering', label: 'Engineering', role: 'Chief Engineer', icon: '⚙️' },
    { id: 'agriculture', label: 'Agriculture', role: 'Head of Agriculture', icon: '🌱' },
    { id: 'psychology', label: 'Psychology', role: 'Colony Psychologist', icon: '🧠' },
    { id: 'governance', label: 'Governance', role: 'Governance Advisor', icon: '🏛️' },
  ],
  presets: [],
  ui: {
    headerMetrics: [
      { id: 'population', format: 'number' }, { id: 'morale', format: 'percent' },
      { id: 'foodMonthsReserve', format: 'number' }, { id: 'powerKw', format: 'number' },
      { id: 'infrastructureModules', format: 'number' }, { id: 'scienceOutput', format: 'number' },
    ],
    tooltipFields: ['boneDensityPct', 'cumulativeRadiationMsv', 'psychScore', 'marsborn'],
    reportSections: ['crisis', 'departments', 'decision', 'outcome', 'quotes'],
    departmentIcons: { medical: '🏥', engineering: '⚙️', agriculture: '🌱', psychology: '🧠', governance: '🏛️' },
    setupSections: ['actors', 'personnel', 'resources', 'departments', 'events', 'models', 'advanced'],
  },
  policies: { toolForging: true, bulletin: true, characterChat: true },
};

const FIRST_RETRY_MS = 2_000;
const LONGEST_RETRY_MS = 15_000;

/**
 * The active scenario. `scenario` is the Mars Genesis fallback until GET
 * /scenario answers, so the page has something to draw; `ready` is true
 * only while `scenario` is the server's answer. A run must wait for it:
 * the fallback's leaders and setup values belong to another world. A failed
 * fetch tries again, with `ready` false, until the server answers.
 */
export function useScenario() {
  const [scenario, setScenario] = useState<ScenarioClientPayload>(MARS_FALLBACK);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let latestRequest = 0;
    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const loadScenario = () => {
      const request = ++latestRequest;
      clearTimeout(retryTimer);
      setReady(false);
      const tryAgain = () => {
        if (request !== latestRequest) return;
        retryTimer = setTimeout(loadScenario, Math.min(FIRST_RETRY_MS * 2 ** failures, LONGEST_RETRY_MS));
        failures += 1;
      };
      fetch('/scenario')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (request !== latestRequest) return;
          if (data?.id) {
            failures = 0;
            setScenario(data);
            setReady(true);
          } else {
            tryAgain();
          }
        })
        .catch(tryAgain);
    };

    loadScenario();
    const unsubscribe = subscribeScenarioUpdates(window, loadScenario);
    return () => {
      latestRequest += 1;
      clearTimeout(retryTimer);
      unsubscribe();
    };
  }, []);

  return { scenario, ready };
}
