import { useState, useEffect } from 'react';
import { subscribeScenarioUpdates } from '../scenario-sync';

export interface ScenarioClientPayload {
  id: string;
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
    cssVariables: Record<string, string>;
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
    leaders?: Array<{ name: string; archetype: string; hexaco: Record<string, number>; instructions: string }>;
    actors?: Array<{ name: string; archetype: string; hexaco: Record<string, number>; instructions: string }>;
    personnel?: Array<{ name: string; department: string; role: string; specialization: string; age: number; featured: boolean }>;
  }>;
  ui: {
    headerMetrics: Array<{ id: string; format: string }>;
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
  theme: { primaryColor: '#dc2626', accentColor: '#f97316', cssVariables: {} },
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

export function useScenario() {
  const [scenario, setScenario] = useState<ScenarioClientPayload>(MARS_FALLBACK);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadScenario = () => {
      fetch('/scenario')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.id) {
            setScenario(data);
            // Inject scenario CSS variables
            if (data.theme?.cssVariables) {
              const root = document.documentElement;
              for (const [key, value] of Object.entries(data.theme.cssVariables)) {
                root.style.setProperty(key, value as string);
              }
            }
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    };

    loadScenario();
    return subscribeScenarioUpdates(window, loadScenario);
  }, []);

  return { scenario, loading };
}
