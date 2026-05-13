import { useState, useCallback, useEffect } from 'react';
import { useDashboardNavigation, useScenarioContext } from '../../App';
import { useScenarioLabels } from '../../hooks/useScenarioLabels';
import { getActorColorVar } from '../../hooks/useGameState';
import { ActorConfig, type ActorFormData } from './ActorConfig';
import { ScenarioEditor } from './ScenarioEditor';
import { LoadPriorRunsCTA } from './LoadPriorRunsCTA';
import { EventLogPanel } from '../log/EventLogPanel';
import { SubTabNav } from '../shared/SubTabNav';
import { getDashboardTabFromHref, resolveSetupRedirectHref, setSubTabUrlParam } from '../../tab-routing';
import { subscribeScenarioUpdates } from '../../scenario-sync';
import type { SimEvent } from '../../hooks/useSSE';
import {
  ECONOMICS_PROFILE_OPTIONS,
  describeServerMode,
  type DashboardEconomicsProfileId,
  type DashboardServerMode,
} from './economicsProfiles';
import {
  SETTINGS_LABEL_STYLE,
  SETTINGS_SECTION_HEADER_STYLE,
} from './shared/settingsStyles';
import { readActiveRunActors, writeActiveRunActors } from '../../hooks/useLastLaunchConfig';
import styles from './SettingsPanel.module.scss';

type SettingsSubTab = 'config' | 'log';

const SETTINGS_SUB_TABS = [
  { id: 'config' as const, label: 'Settings' },
  { id: 'log' as const, label: 'Event Log' },
];

const DEFAULT_HEXACO: Record<string, number> = {
  openness: 0.5, conscientiousness: 0.5, extraversion: 0.5,
  agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5,
};

/**
 * Model options per provider, ordered cheapest first. Labels include a
 * rough price hint so users can eyeball the cost impact before they pick.
 * Values mirror the keys in the server-side MODEL_PRICING table.
 */
const MODEL_OPTIONS: Record<'openai' | 'anthropic', Array<{ value: string; label: string }>> = {
  openai: [
    { value: 'gpt-5.4-nano',  label: 'gpt-5.4-nano  ($0.20 / $1.25 per 1M)' },
    { value: 'gpt-5.4-mini',  label: 'gpt-5.4-mini  ($0.75 / $4.50 per 1M)' },
    { value: 'gpt-5.4',       label: 'gpt-5.4       ($2.50 / $15.00 per 1M)' },
    { value: 'gpt-5.4-pro',   label: 'gpt-5.4-pro   ($30 / $180 per 1M — avoid)' },
  ],
  anthropic: [
    { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5    ($1 / $5 per 1M)' },
    { value: 'claude-sonnet-4-6',         label: 'Sonnet 4.6   ($3 / $15 per 1M)' },
    { value: 'claude-opus-4-7',           label: 'Opus 4.7     ($5 / $25 per 1M)' },
  ],
};

type ModelTier = 'departments' | 'commander' | 'director' | 'judge' | 'agentReactions';

/**
 * Default BYO-key tier selections: flagship for forging, mid-tier for
 * structured output, cheapest for high-volume reactions.
 */
const DEFAULT_TIER_MODELS: Record<'openai' | 'anthropic', Record<ModelTier, string>> = {
  openai: {
    departments:    'gpt-5.4',
    commander:      'gpt-5.4-mini',
    director:       'gpt-5.4-mini',
    judge:          'gpt-5.4-mini',
    agentReactions: 'gpt-5.4-nano',
  },
  anthropic: {
    departments:    'claude-sonnet-4-6',
    commander:      'claude-haiku-4-5-20251001',
    director:       'claude-haiku-4-5-20251001',
    judge:          'claude-haiku-4-5-20251001',
    agentReactions: 'claude-haiku-4-5-20251001',
  },
};

const TIER_LABELS: Record<ModelTier, { label: string; help: string }> = {
  departments:    { label: 'Departments (forges)',   help: 'Writes code, schemas, test cases. Quality matters — cheap tier produces broken forges.' },
  commander:      { label: 'Commander',              help: 'Picks option from department reports. Mid-tier is fine.' },
  director:       { label: 'Event Director',         help: 'Generates crisis events as structured JSON batches.' },
  judge:          { label: 'Judge (code review)',    help: 'Reviews forged tool code for safety + correctness.' },
  agentReactions: { label: 'Agent Reactions',        help: 'One to two sentences per colonist per turn. Highest volume — pick cheapest.' },
};

/**
 * Generic per-slot defaults so the Settings panel can render N actor
 * forms instead of just the original two. Indexes 0/1 keep their
 * legacy names (Actor A / Actor B + Visionary / Engineer archetypes
 * + Colony Alpha / Beta units) so pair-mode runs feel identical to
 * the pre-cohort UX; cohort slots fall through to numbered defaults.
 */
const PHONETIC_UNITS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
const COHORT_ARCHETYPES = [
  'The Visionary',
  'The Engineer',
  'The Diplomat',
  'The Maverick',
  'The Guardian',
  'The Strategist',
  'The Steward',
  'The Innovator',
];

function defaultLeader(idx: number): ActorFormData {
  const slotLetter = String.fromCharCode(65 + (idx % 26));
  const phonetic = PHONETIC_UNITS[idx] ?? `Group ${idx + 1}`;
  return {
    name: `Actor ${slotLetter}`,
    archetype: COHORT_ARCHETYPES[idx] ?? 'The Strategist',
    unit: `Colony ${phonetic}`,
    instructions: '',
    hexaco: { ...DEFAULT_HEXACO },
  };
}

/** Lower bound — Sim API rejects under 2 actors (non-fork paths). */
const MIN_ACTORS = 2;
/** Upper bound for the Settings panel UI. The server accepts up to
 *  300 (matches the Quickstart slider), but past ~8 the per-actor
 *  HEXACO form scroll becomes a lot to manage from this surface.
 *  Users wanting larger cohorts should use Quickstart's generate-N
 *  flow which produces actor configs from a single prompt. */
const MAX_ACTORS = 8;

export interface SettingsPanelProps {
  /** SSE events to feed the embedded EventLogPanel sub-tab. Optional
   *  so callers that don't care about Log (or mount Settings before the
   *  SSE pipe is ready) can omit it; the sub-tab just renders an empty
   *  log in that case. */
  events?: SimEvent[];
  /** Sub-tab to land on. Used by tab-routing redirects: `?tab=log`
   *  lands on `settings?subTab=log` for backward compat with deep
   *  links from before the merge. */
  initialSubTab?: SettingsSubTab;
}

export function SettingsPanel({ events = [], initialSubTab = 'config' }: SettingsPanelProps = {}) {
  const [subTab, setSubTab] = useState<SettingsSubTab>(initialSubTab);
  // Persist sub-tab in the URL so refresh / shared links land back on
  // the user's last open panel. 'config' is the default — omit the
  // param for that case to keep the URL clean.
  const handleSubTabChange = useCallback((next: SettingsSubTab) => {
    setSubTab(next);
    setSubTabUrlParam(next === 'config' ? null : next);
  }, []);
  const scenario = useScenarioContext();
  const labels = useScenarioLabels();
  const navigateTab = useDashboardNavigation();

  const defaultPreset = scenario.presets.find(p => p.id === 'default');
  // Server's projectScenarioForClient now ships ScenarioPreset.leaders
  // (engine-side field name); the legacy `actors` alias is preserved on
  // the type but only older fixtures populate it. Read leaders first so
  // hosted prod's Mars Genesis preset surfaces "Aria Chen / Dietrich
  // Voss" instead of the defaultLeader(0/1) placeholder.
  //
  // For compiled scenarios (which ship no presets) the form falls back
  // to actors persisted by the most recent /setup launch. Without that
  // fallback the form rendered "Actor A" / "Actor B" placeholders even
  // though the user had just launched a clinical or bookstore run with
  // real generated actors a moment ago.
  const presetLeaders = defaultPreset?.leaders ?? defaultPreset?.actors;
  const persistedActors =
    typeof window !== 'undefined' ? readActiveRunActors(window.localStorage) : null;
  // Cohort-aware initial state: merge presets, persisted launch config,
  // and per-slot defaults. The Settings panel renders up to MAX_ACTORS
  // actor forms; runs that previously launched with 3+ actors via
  // Quickstart resume here with their full roster intact instead of
  // collapsing back to the legacy pair view. Pair-only sources (a
  // 2-actor preset on a scenario built before cohorts) still hydrate
  // the first two slots and leave the rest at their slot defaults.
  const presetActorCount = Math.max(
    MIN_ACTORS,
    Math.min(MAX_ACTORS, presetLeaders?.length ?? persistedActors?.length ?? MIN_ACTORS),
  );
  const initActors: ActorFormData[] = Array.from({ length: presetActorCount }, (_, idx) => {
    const fallback =
      presetLeaders?.[idx] ??
      (persistedActors?.[idx] as { name?: string; archetype?: string; unit?: string; instructions?: string; hexaco?: Record<string, number> } | undefined);
    if (!fallback?.name) return defaultLeader(idx);
    return {
      name: fallback.name,
      archetype: fallback.archetype ?? '',
      unit: fallback.unit ?? `Colony ${PHONETIC_UNITS[idx] ?? `${idx + 1}`}`,
      instructions: fallback.instructions ?? '',
      // Spread so the form's per-trait edits don't mutate the preset
      // shared via the scenario context.
      hexaco: { ...(fallback.hexaco ?? DEFAULT_HEXACO) },
    };
  });

  const [actors, setActors] = useState<ActorFormData[]>(initActors);

  // Re-populate from presets when scenario data loads (async fetch).
  // Depend on presets length because the fallback has presets:[] but
  // the same id. Preserves the user's actor count when the preset has
  // fewer entries than the current form (no shrink on scenario load).
  useEffect(() => {
    const p = scenario.presets.find(p => p.id === 'default');
    const leaders = p?.leaders ?? p?.actors;
    if (!leaders || leaders.length === 0) return;
    setActors(prev => prev.map((existing, idx) => {
      const preset = leaders[idx];
      if (!preset) return existing;
      return {
        name: preset.name,
        archetype: preset.archetype,
        unit: existing.unit || `Colony ${PHONETIC_UNITS[idx] ?? `${idx + 1}`}`,
        instructions: preset.instructions,
        hexaco: { ...preset.hexaco },
      };
    }));
  }, [scenario.id, scenario.presets.length]);

  const updateActor = useCallback((idx: number, next: ActorFormData) => {
    setActors(prev => prev.map((a, i) => (i === idx ? next : a)));
  }, []);

  const addActor = useCallback(() => {
    setActors(prev => (prev.length < MAX_ACTORS ? [...prev, defaultLeader(prev.length)] : prev));
  }, []);

  const removeActor = useCallback((idx: number) => {
    setActors(prev => (prev.length > MIN_ACTORS ? prev.filter((_, i) => i !== idx) : prev));
  }, []);
  const [turns, setTurns] = useState(scenario.setup.defaultTurns);
  const [seed, setSeed] = useState(scenario.setup.defaultSeed);
  const [startTime, setStartTime] = useState(scenario.setup.defaultStartTime);
  const [timePerTurn, setTimePerTurn] = useState(scenario.setup.defaultTimePerTurn || 0);
  const [population, setPopulation] = useState(scenario.setup.defaultPopulation);
  const [provider, setProvider] = useState('openai');
  const [liveSearch, setLiveSearch] = useState(false);
  const [economicsProfile, setEconomicsProfile] = useState<DashboardEconomicsProfileId>('balanced');
  const [launching, setLaunching] = useState(false);
  const [status, setStatus] = useState('');
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string; description: string; departments: number }>>([]);
  const [activeId, setActiveId] = useState(scenario.id);

  // API key state: env flags tell us what's configured server-side; overrides are user-entered values
  const [envKeys, setEnvKeys] = useState<Record<string, boolean>>({});
  const [hostedDemo, setHostedDemo] = useState(false);
  const [serverMode, setServerMode] = useState<DashboardServerMode>('local_demo');
  // Demo caps fetched from the server so lock labels read the current
  // effective numbers (driven by PARACOSM_DEMO_MAX_TURNS env var on
  // prod) instead of a stale client-side constant.
  const [demoCaps, setDemoCaps] = useState<{ maxTurns: number; maxPopulation: number; maxActiveDepartments: number }>({
    maxTurns: 6, maxPopulation: 30, maxActiveDepartments: 3,
  });
  // Keys persist in localStorage so users don't have to re-enter them on every
  // page reload. Written on change, read on mount. The key itself never
  // leaves the browser except as part of a /setup or /compile request body;
  // it is never rendered back into the input and is submitted with
  // autoComplete=off.
  const [keyOverrides, setKeyOverrides] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem('paracosm:keyOverrides');
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, string>;
        return {
          openai: parsed.openai || '', anthropic: parsed.anthropic || '',
          serper: parsed.serper || '', firecrawl: parsed.firecrawl || '',
          tavily: parsed.tavily || '', cohere: parsed.cohere || '',
        };
      }
    } catch { /* localStorage unavailable or JSON malformed — fall through */ }
    return { openai: '', anthropic: '', serper: '', firecrawl: '', tavily: '', cohere: '' };
  });
  useEffect(() => {
    try {
      localStorage.setItem('paracosm:keyOverrides', JSON.stringify(keyOverrides));
    } catch { /* quota or privacy mode — silent */ }
  }, [keyOverrides]);

  // Per-tier model choices for BYO-key users. Initialised from defaults for
  // the currently selected provider; reset whenever the provider changes so
  // the UI never shows claude-* values while provider='openai' (or vice
  // versa). Hidden entirely when the server is in hosted-demo mode and no
  // user override has been entered — the server forces DEMO_MODELS on that
  // path so user-picked values would be ignored.
  const [tierModels, setTierModels] = useState<Record<ModelTier, string>>(
    DEFAULT_TIER_MODELS[provider as 'openai' | 'anthropic'] ?? DEFAULT_TIER_MODELS.openai,
  );
  useEffect(() => {
    const p = (provider as 'openai' | 'anthropic');
    if (DEFAULT_TIER_MODELS[p]) setTierModels(DEFAULT_TIER_MODELS[p]);
  }, [provider]);

  // Show the per-tier model picker when ANY LLM key is available AND the
  // server is not operating as a hosted demo. On local dev the .env keys
  // belong to the user, so env presence is enough. On the hosted Linode
  // the server sets PARACOSM_HOSTED_DEMO=true and env keys belong to the
  // host — picker then requires an explicit session override from the user.
  const hasSessionLlmKey = !!keyOverrides.openai || !!keyOverrides.anthropic;
  const hasEnvLlmKey = !!envKeys.openai || !!envKeys.anthropic;
  const canPickModels = hasSessionLlmKey || (!hostedDemo && hasEnvLlmKey);
  // `hasUserLlmKey` controls whether launch() attaches `config.models`.
  // The server only honors tier picks when the request includes a session
  // key OR when hosted-demo mode is off (local dev trusts env keys as the
  // user's own). Same contract as applyDemoCaps on the server side.
  const hasUserLlmKey = hasSessionLlmKey || (!hostedDemo && hasEnvLlmKey);
  const effectiveEconomicsProfile: DashboardEconomicsProfileId =
    hostedDemo && !hasSessionLlmKey ? 'economy' : economicsProfile;
  const serverModeInfo = describeServerMode(serverMode);
  const isLocked = hostedDemo && !hasSessionLlmKey;

  const refreshScenarioCatalog = useCallback(() => {
    fetch('/scenarios')
      .then(r => r.json())
      .then(d => {
        setScenarios(d.scenarios || []);
        setActiveId(d.active);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshScenarioCatalog();
    // Fetch which API keys are configured from .env + hosted-demo flag
    fetch('/admin-config')
      .then(r => r.json())
      .then(data => {
        if (data.keys) setEnvKeys(data.keys);
        if (typeof data.hostedDemo === 'boolean') setHostedDemo(data.hostedDemo);
        if (typeof data.serverMode === 'string') setServerMode(data.serverMode as DashboardServerMode);
        if (data.demoCaps && typeof data.demoCaps.maxTurns === 'number') {
          setDemoCaps({
            maxTurns: data.demoCaps.maxTurns,
            maxPopulation: data.demoCaps.maxPopulation ?? 30,
            maxActiveDepartments: data.demoCaps.maxActiveDepartments ?? 3,
          });
        }
      })
      .catch(() => {});
    return subscribeScenarioUpdates(window, refreshScenarioCatalog);
  }, [refreshScenarioCatalog]);

  const switchScenario = async (id: string) => {
    if (id === activeId) return;
    try {
      const res = await fetch('/scenario/switch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch {}
  };

  const launch = useCallback(async () => {
    setLaunching(true);
    setStatus('Starting...');
    try {
      const config: Record<string, unknown> = {
        actors: actors.map(a => ({ ...a, hexaco: a.hexaco })),
        provider, turns, seed, startTime, timePerTurn: timePerTurn || undefined, population, liveSearch,
        activeDepartments: scenario.departments.map(d => d.id),
        economics: { profileId: effectiveEconomicsProfile },
      };
      // Persist the last-launched config shape so a "re-run with seed+1"
      // button on the completed-sim screen can reuse it without asking
      // the user to fill the Settings form again. Only store
      // non-sensitive fields — API keys already live under
      // paracosm:keyOverrides with their own retention semantics.
      try {
        localStorage.setItem('paracosm:lastLaunchConfig', JSON.stringify(config));
      } catch { /* quota or privacy mode — silent */ }
      // Persist the leaders the user is about to launch so the live SIM
      // header has names available during the SSE connect-and-replay
      // window. Without this, compiled-scenario runs render the
      // alphabetic placeholder until status:parallel lands.
      writeActiveRunActors(window.localStorage, actors);
      // Attach any user-provided key overrides (never sends .env values)
      if (keyOverrides.openai) config.apiKey = keyOverrides.openai;
      if (keyOverrides.anthropic) config.anthropicKey = keyOverrides.anthropic;
      if (keyOverrides.serper) config.serperKey = keyOverrides.serper;
      if (keyOverrides.firecrawl) config.firecrawlKey = keyOverrides.firecrawl;
      if (keyOverrides.tavily) config.tavilyKey = keyOverrides.tavily;
      if (keyOverrides.cohere) config.cohereKey = keyOverrides.cohere;
      // Per-tier model overrides only apply when the user is paying. The
      // server enforces DEMO_MODELS otherwise, so sending these without a
      // key would be silently overwritten.
      if (hasUserLlmKey) {
        config.models = { ...tierModels };
      }
      const res = await fetch('/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Tier 2 Spec 2B: UI-initiated runs capture kernel snapshots
        // so every turn is fork-eligible from the Reports tab.
        body: JSON.stringify({ ...config, captureSnapshots: true }),
      });
      const data = await res.json();
      if (res.status === 429) {
        setStatus(`Rate limited: ${data.error || 'too many simulations'}`);
        setLaunching(false);
        return;
      }
      if (data.redirect) {
        setStatus('Running...');
        const targetHref = resolveSetupRedirectHref(window.location.href, data.redirect);
        const resolvedTab = getDashboardTabFromHref(targetHref);
        navigateTab(resolvedTab === 'about' ? 'sim' : resolvedTab as Exclude<typeof resolvedTab, 'about'>);
      } else {
        setStatus(`Error: ${data.error || 'unknown'}`);
        setLaunching(false);
      }
    } catch (err) {
      setStatus(`Failed: ${err}`);
      setLaunching(false);
    }
  }, [actors, turns, seed, startTime, timePerTurn, population, provider, liveSearch, navigateTab, scenario, keyOverrides, tierModels, hasUserLlmKey, effectiveEconomicsProfile]);

  const inputCls = (locked: boolean) =>
    [styles.input, locked ? styles.locked : ''].filter(Boolean).join(' ');

  return (
    <div className={styles.root}>
      <SubTabNav
        options={SETTINGS_SUB_TABS}
        active={subTab}
        onChange={handleSubTabChange}
        ariaLabel="Settings sub-navigation"
      />
      {subTab === 'log' && <EventLogPanel events={events} />}
      {subTab === 'config' && (
    <div className={`settings-content ${styles.content}`}>
      {/* Prior-runs CTA — surfaces saved sessions at the top so users
          who don't want to spend credits can replay an existing run
          turn-by-turn without touching any API keys. Hides itself when
          no saved runs exist or the session store is unavailable. */}
      <LoadPriorRunsCTA />
      {/* Scenario Selector */}
      {scenarios.length > 0 && (
        <div className={`responsive-stack ${styles.scenarioRow}`}>
          <label htmlFor="scenario-select" style={SETTINGS_LABEL_STYLE} className={styles.scenarioLabel}>
            Scenario
          </label>
          <select
            id="scenario-select"
            className={`pc-select ${styles.scenarioSelect}`}
            value={activeId}
            onChange={e => switchScenario(e.target.value)}
          >
            {scenarios.map(s => {
              const sourceTag = s.description?.includes('(memory)')
                ? ' [memory]'
                : s.description?.includes('(disk)')
                ? ' [disk]'
                : s.description?.includes('compiled')
                ? ' [compiled]'
                : '';
              return (
                <option key={s.id} value={s.id}>
                  {s.id === activeId ? '● ' : ''}{s.name} ({s.departments} depts){sourceTag}
                </option>
              );
            })}
          </select>
          <span className={styles.scenarioActiveTag}>
            Active: <strong className={styles.scenarioActiveValue}>{activeId}</strong>
          </span>
        </div>
      )}

      <h2 className={styles.h2}>{scenario.labels.name}</h2>
      {scenario.labels.tagline && (
        <p className={styles.scenarioTagline}>{scenario.labels.tagline}</p>
      )}
      <p className={styles.lead}>
        Configure your leaders and launch. {scenario.departments.length} departments: {scenario.departments.map(d => d.label).join(', ')}.
      </p>
      {scenario.sourceUrl && (
        <p className={styles.scenarioSourceLink}>
          <a
            href={scenario.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View scenario JSON on GitHub →
          </a>
        </p>
      )}
      <p className={styles.leadHint}>
        Server mode: <strong className={styles.leadStrong}>{serverModeInfo.label}</strong>. {serverModeInfo.description}
      </p>

      {/* Leaders grid. Renders N actor forms (2 ≤ N ≤ MAX_ACTORS).
          Pair-mode runs (2 actors) layout in the responsive-grid-2
          column pair; cohort runs (3+) flow into a responsive grid so
          larger cohorts stack two-per-row instead of one column per
          slot. Each card carries a Remove button when the cohort is
          past MIN_ACTORS; the bottom of the section has an "Add
          actor" CTA that pushes a slot-defaulted new actor until the
          cohort hits MAX_ACTORS. */}
      <div className={`${actors.length > 2 ? 'responsive-grid-cohort' : 'responsive-grid-2'} ${styles.leadersGrid}`}>
        {actors.map((actor, idx) => (
          <div key={idx} className={styles.leaderCardWrap} style={{ position: 'relative' }}>
            <ActorConfig
              label={`Commander ${String.fromCharCode(65 + (idx % 26))}`}
              sideColor={getActorColorVar(idx)}
              data={actor}
              onChange={(next) => updateActor(idx, next)}
            />
            {actors.length > MIN_ACTORS && (
              <button
                type="button"
                onClick={() => removeActor(idx)}
                className={styles.leaderRemoveBtn}
                aria-label={`Remove ${actor.name || `actor ${idx + 1}`} from the cohort`}
                title="Remove this actor"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <div className={styles.leadersAddRow}>
        {actors.length < MAX_ACTORS ? (
          <button
            type="button"
            onClick={addActor}
            className={styles.leaderAddBtn}
            aria-label="Add another actor to the cohort"
          >
            + Add actor ({actors.length}/{MAX_ACTORS})
          </button>
        ) : (
          <span className={styles.leaderAddCap}>
            Max {MAX_ACTORS} actors from Settings · use Quickstart's generate-N flow for larger cohorts.
          </span>
        )}
      </div>

      {/* Simulation config */}
      <fieldset className={styles.fieldset}>
        <legend style={SETTINGS_SECTION_HEADER_STYLE} className={styles.legend}>
          Simulation
        </legend>
        {/* Demo-mode cap hint: rendered inline with the Simulation
            fieldset so users see what values the server will force
            before they hit Launch. Mirrors applyDemoCaps on the
            backend. Disappears once a session LLM key is entered. */}
        {isLocked && (
          <div className={styles.demoBanner}>
            <strong className={styles.demoBannerLabel}>Demo caps will apply:</strong>{' '}
            turns clamped to {demoCaps.maxTurns}, population to {demoCaps.maxPopulation}, active departments to {demoCaps.maxActiveDepartments}.
            Values you enter below are honored up to those ceilings. Add a
            session API key above to lift the caps.
          </div>
        )}
        <div className={`responsive-grid-4 ${styles.simRow5}`}>
          <div>
            <label htmlFor="turns-input" style={SETTINGS_LABEL_STYLE}>
              Turns
              {isLocked && (
                <span className={styles.lockTag} title={`Hosted demo caps turns at ${demoCaps.maxTurns}. Add a session API key to unlock.`}>
                  🔒 demo:{demoCaps.maxTurns}
                </span>
              )}
            </label>
            <input
              id="turns-input"
              type="number"
              value={isLocked ? demoCaps.maxTurns : turns}
              onChange={e => setTurns(parseInt(e.target.value) || 12)}
              min={1}
              max={20}
              disabled={isLocked}
              className={inputCls(isLocked)}
              title={isLocked ? `Locked at ${demoCaps.maxTurns} in hosted demo mode. Add your own OpenAI or Anthropic key above to unlock full scope.` : ''}
            />
          </div>
          <div>
            <label htmlFor="ypt-input" style={SETTINGS_LABEL_STYLE}>{labels.Times}/Turn</label>
            <input
              id="ypt-input"
              type="number"
              value={timePerTurn}
              onChange={e => setTimePerTurn(parseInt(e.target.value) || 0)}
              min={0}
              max={50}
              placeholder="auto"
              title={`${labels.Times} per turn. 0 = accelerating schedule (default). 1 = 1 ${labels.time} per turn. 5 = 5 ${labels.times} per turn.`}
              className={styles.input}
            />
          </div>
          <div>
            <label htmlFor="seed-input" style={SETTINGS_LABEL_STYLE}>Seed</label>
            <input id="seed-input" type="number" value={seed} onChange={e => setSeed(parseInt(e.target.value) || 950)} className={styles.input} />
          </div>
          <div>
            <label htmlFor="time-input" style={SETTINGS_LABEL_STYLE}>Start {labels.Time}</label>
            <input id="time-input" type="number" value={startTime} onChange={e => setStartTime(parseInt(e.target.value) || 2035)} className={styles.input} />
          </div>
          <div>
            <label htmlFor="pop-input" style={SETTINGS_LABEL_STYLE}>
              Population
              {isLocked && (
                <span className={styles.lockTag} title="Hosted demo caps population at 30. Add a session API key to unlock.">
                  🔒 demo:30
                </span>
              )}
            </label>
            <input
              id="pop-input"
              type="number"
              value={isLocked ? 30 : population}
              onChange={e => setPopulation(parseInt(e.target.value) || 100)}
              disabled={isLocked}
              className={inputCls(isLocked)}
              title={isLocked ? 'Locked at 30 in hosted demo mode. Add your own OpenAI or Anthropic key above to unlock full scope.' : ''}
            />
          </div>
        </div>
        <div className={`responsive-grid-3 ${styles.grid3}`}>
          <div>
            <label htmlFor="provider-select" style={SETTINGS_LABEL_STYLE}>Provider</label>
            <select id="provider-select" className={`pc-select ${styles.input}`} value={provider} onChange={e => setProvider(e.target.value)}>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>
          <div>
            <label htmlFor="search-select" style={SETTINGS_LABEL_STYLE}>Live Search</label>
            <select id="search-select" className={`pc-select ${styles.input}`} value={String(liveSearch)} onChange={e => setLiveSearch(e.target.value === 'true')}>
              <option value="false">Off</option>
              <option value="true">On (requires search API keys)</option>
            </select>
          </div>
          <div>
            <label htmlFor="economics-select" style={SETTINGS_LABEL_STYLE}>
              Economics
              {isLocked && <span className={styles.lockTag}>🔒 forced:economy</span>}
            </label>
            <select
              id="economics-select"
              className={`pc-select ${inputCls(isLocked)}`}
              value={effectiveEconomicsProfile}
              onChange={e => setEconomicsProfile(e.target.value as DashboardEconomicsProfileId)}
              disabled={isLocked}
              title={ECONOMICS_PROFILE_OPTIONS.find(option => option.value === effectiveEconomicsProfile)?.description}
            >
              {ECONOMICS_PROFILE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className={styles.fieldHint}>
              {ECONOMICS_PROFILE_OPTIONS.find(option => option.value === effectiveEconomicsProfile)?.description}
            </div>
          </div>
        </div>
      </fieldset>

      {/* API Keys */}
      <fieldset className={styles.fieldset}>
        <legend style={SETTINGS_SECTION_HEADER_STYLE} className={styles.legend}>
          API Keys
        </legend>
        <div className={styles.keysIntro}>
          <p className={styles.keysIntroPara}>
            <strong className={styles.keysIntroBoldNeutral}>How key resolution works:</strong> The server checks for keys in this order:
            your session overrides below, then the server .env file. If a key exists in either place, it's used. Values entered here are never displayed back.
          </p>
          <p className={styles.keysIntroPara}>
            <strong className={styles.keysIntroBoldGreen}>Rate limiting:</strong> The hosted demo limits simulations per IP per day when using the server's API keys.
            Provide your own <strong>OpenAI</strong> or <strong>Anthropic</strong> key to bypass the rate limit and run unlimited simulations.
            Only one LLM provider key is required. If both are provided, the simulation uses whichever you select as the provider.
          </p>
          <p className={styles.keysIntroPara}>
            <strong className={styles.keysIntroBoldAmber}>Research and citations:</strong> Live web search requires at least one search key (Serper, Firecrawl, Tavily).
            Without any search key, departments fall back to the scenario's built-in research bundle. Cohere enables neural reranking of search results for higher-quality citations.
            These are optional enhancements, not required to run a simulation.
          </p>
          <p className={styles.keysIntroParaLast}>
            <strong className={styles.keysIntroBoldRust}>No keys at all?</strong> If neither a server .env key nor a session override exists for any LLM provider,
            the simulation cannot run. You need at least one OpenAI or Anthropic key configured somewhere.
          </p>
        </div>
        <div className={`responsive-grid-2 ${styles.grid2}`}>
          {([
            ['openai', 'OpenAI', 'Required (or Anthropic). Powers commander, departments, crisis director.'],
            ['anthropic', 'Anthropic', 'Required (or OpenAI). Alternative LLM provider for all simulation roles.'],
            ['serper', 'Serper (search)', 'Optional. Enables live Google search for department research citations.'],
            ['firecrawl', 'Firecrawl (scrape)', 'Optional. Enables web page scraping for deeper research context.'],
            ['tavily', 'Tavily (search)', 'Optional. Additional search provider. Multiple providers improve coverage.'],
            ['cohere', 'Cohere (rerank)', 'Optional. Neural reranking of search results for citation quality.'],
          ] as const).map(([key, label, desc]) => (
            <div key={key}>
              <label htmlFor={`key-${key}`} style={SETTINGS_LABEL_STYLE}>
                {label}
                {envKeys[key] && <span className={styles.keyEnvTag}>(.env active)</span>}
              </label>
              <input
                id={`key-${key}`}
                type="password"
                autoComplete="off"
                value={keyOverrides[key]}
                onChange={e => setKeyOverrides(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={envKeys[key] ? 'Using .env value' : 'Not configured'}
                className={styles.input}
              />
              <div className={styles.fieldHint}>{desc}</div>
            </div>
          ))}
        </div>
      </fieldset>

      {/* Per-tier model picker. Visible when the caller is paying for
          the run — either a session override is set, or env keys are
          configured and the server is not in hosted-demo mode (local
          dev). Matches the server-side contract: in hosted-demo mode,
          applyDemoCaps overwrites whatever models the client posts. */}
      {canPickModels && (provider === 'openai' || provider === 'anthropic') && (
        <fieldset className={styles.fieldset}>
          <legend style={SETTINGS_SECTION_HEADER_STYLE} className={styles.legend}>
            Model Tiers
          </legend>
          <div className={styles.modelTiersIntro}>
            Assign a model to each agent tier. Departments do the forging and benefit most from the flagship class.
            Agent reactions fan out to hundreds of parallel calls per turn and should be the cheapest class available.
            These overrides are only used when you run against your own API key.
          </div>
          <div className={`responsive-grid-2 ${styles.grid2}`}>
            {(Object.keys(TIER_LABELS) as ModelTier[]).map(tier => (
              <div key={tier}>
                <label htmlFor={`model-${tier}`} style={SETTINGS_LABEL_STYLE}>
                  {TIER_LABELS[tier].label}
                </label>
                <select
                  id={`model-${tier}`}
                  className={`pc-select ${styles.input}`}
                  value={tierModels[tier]}
                  onChange={e => setTierModels(prev => ({ ...prev, [tier]: e.target.value }))}
                >
                  {MODEL_OPTIONS[provider as 'openai' | 'anthropic'].map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <div className={styles.fieldHint}>
                  {TIER_LABELS[tier].help}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      )}

      {!canPickModels && (
        <div className={styles.demoMode}>
          <strong className={styles.demoModeStrong}>Demo mode.</strong>{' '}
          {hostedDemo
            ? `Runs against the host API keys are capped to ${demoCaps.maxTurns} turns, ${demoCaps.maxPopulation} colonists, ${demoCaps.maxActiveDepartments} departments, and the cheapest model class. Add your own OpenAI or Anthropic key above to unlock full scope and per-tier model selection.`
            : 'No API key configured. Add an OpenAI or Anthropic key above or set one in .env to enable simulations and the per-tier model picker.'}
        </div>
      )}

      {/* Scenario Editor: create, import, export, compile */}
      <ScenarioEditor />

      {/* Launch */}
      <div className={`responsive-stack ${styles.launchRow}`}>
        <button
          onClick={launch}
          disabled={launching}
          aria-label={launching ? 'Simulation running' : 'Launch simulation'}
          className={styles.launchBtn}
        >
          {launching ? 'Running...' : 'Launch Simulation'}
        </button>
        {status && <span role="status" className={styles.launchStatus}>{status}</span>}
      </div>
    </div>
      )}
    </div>
  );
}
