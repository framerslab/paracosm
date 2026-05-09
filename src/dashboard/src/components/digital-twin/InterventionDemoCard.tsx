/**
 * InterventionDemoCard renders the editable Subject + Intervention form
 * that drives the digital-twin run on the Quickstart input phase. The
 * form starts empty and the user fills in any subject (patient, market,
 * jurisdiction, vehicle, ...) plus any intervention (treatment, launch,
 * ordinance, mission profile, ...). Three preset buttons (medical,
 * policy, product) load example payloads for users who want a starting
 * point.
 *
 * Click hits POST /api/quickstart/simulate-intervention with the
 * dynamically-built SubjectConfig + InterventionConfig. On 200 the
 * artifact is forwarded to the parent (App.tsx) which parks it and
 * switches to the SIM tab so DigitalTwinPanel renders the result.
 *
 * @module paracosm/dashboard/digital-twin/InterventionDemoCard
 */
import { useState } from 'react';
import type { RunArtifact } from '../../../../engine/schema/index.js';
import styles from './InterventionDemoCard.module.scss';

export interface InterventionDemoCardProps {
  onResult: (artifact: RunArtifact) => void;
  onError?: (message: string) => void;
  onRunStart?: (payload: {
    subject: { id: string; name: string; profile?: Record<string, unknown> };
    intervention: { id: string; name: string; description: string; duration?: { value: number; unit: string } };
  }) => void;
}

interface SubjectForm {
  id: string;
  name: string;
  description: string;
  profileJson: string;
}

interface InterventionForm {
  id: string;
  name: string;
  description: string;
  durationValue: string;
  durationUnit: string;
  adherence: string;
}

interface Preset {
  label: string;
  blurb: string;
  subject: SubjectForm;
  intervention: InterventionForm;
  signalsJson: string;
}

const EMPTY_SUBJECT: SubjectForm = {
  id: '',
  name: '',
  description: '',
  profileJson: '{}',
};

const EMPTY_INTERVENTION: InterventionForm = {
  id: '',
  name: '',
  description: '',
  durationValue: '12',
  durationUnit: 'weeks',
  adherence: '0.85',
};

const PRESETS: Record<string, Preset> = {
  medical: {
    label: 'Patient · treatment',
    blurb: 'Type 2 diabetes patient on a 12-week semaglutide + lifestyle protocol.',
    subject: {
      id: 'patient-maria-2026',
      name: 'Maria Chen',
      description: '58 y/o T2D for 4 yrs, sedentary, family hx CVD, on metformin.',
      profileJson: JSON.stringify({
        age: 58,
        yearsWithT2D: 4,
        bmi: 31,
        a1cBaseline: 7.8,
        weightLb: 178,
        fastingGlucose: 156,
        sleepHoursBaseline: 6.2,
        exerciseMinPerWeek: 0,
        comorbidities: 'hypertension, dyslipidemia',
      }, null, 2),
    },
    intervention: {
      id: 'glp1-12wk-protocol',
      name: '12-week semaglutide + lifestyle protocol',
      description: 'Initiate semaglutide 0.25mg weekly, titrate to 1.0mg by week 4. Pair with dietitian-led nutrition plan and 150min/wk graded exercise. Behavioral health checkpoints biweekly. Monitor for GI side effects, gallbladder, pancreatitis.',
      durationValue: '84',
      durationUnit: 'days',
      adherence: '0.85',
    },
    signalsJson: JSON.stringify([
      { label: 'HbA1c', value: 7.8, unit: '%', recordedAt: '2026-09-15T00:00:00Z' },
      { label: 'Fasting glucose', value: 156, unit: 'mg/dL', recordedAt: '2026-09-15T00:00:00Z' },
      { label: 'Weight', value: 178, unit: 'lb', recordedAt: '2026-09-15T00:00:00Z' },
      { label: 'BMI', value: 31, unit: 'kg/m²', recordedAt: '2026-09-15T00:00:00Z' },
    ], null, 2),
  },
  policy: {
    label: 'Jurisdiction · ordinance',
    blurb: 'A mid-size city pilots downtown congestion pricing for 12 months.',
    subject: {
      id: 'city-portland-2026',
      name: 'Portland Metro',
      description: 'Pacific Northwest mid-size city with dense urban core, mature transit, organized downtown business association.',
      profileJson: JSON.stringify({
        population: 650000,
        downtownEmployment: 110000,
        modeShareTransit: 0.18,
        modeShareCar: 0.62,
        modeShareActive: 0.14,
        avgPeakSpeedMph: 14.2,
        annualCO2Tons: 1820000,
        unemploymentRate: 0.044,
      }, null, 2),
    },
    intervention: {
      id: 'congestion-pricing-12mo',
      name: 'Downtown congestion pricing pilot',
      description: 'Charge $9/peak-hour ($3 off-peak) on vehicles entering the central business district 6am-7pm Mon-Fri. Revenue funds two new BRT lines and a 30% transit fare cut for low-income riders. Pilot runs 12 months with quarterly review.',
      durationValue: '12',
      durationUnit: 'months',
      adherence: '0.78',
    },
    signalsJson: JSON.stringify([
      { label: 'Downtown VMT', value: 1.42, unit: 'million-mi/day', recordedAt: '2026-04-01T00:00:00Z' },
      { label: 'Transit ridership', value: 118000, unit: 'boardings/day', recordedAt: '2026-04-01T00:00:00Z' },
      { label: 'Peak speed', value: 14.2, unit: 'mph', recordedAt: '2026-04-01T00:00:00Z' },
    ], null, 2),
  },
  product: {
    label: 'Market · launch',
    blurb: 'A SaaS launches a new mid-tier price point against a price-sensitive prosumer segment.',
    subject: {
      id: 'segment-prosumer-creators',
      name: 'Prosumer creators',
      description: 'Independent creators earning $40k-$120k/yr who self-fund their tooling. Cross-tool stackers; price-sensitive within 20% bands.',
      profileJson: JSON.stringify({
        addressableUsers: 1800000,
        currentPaidConversion: 0.034,
        avgARPU_USD: 22,
        churnMonthly: 0.038,
        npsCurrent: 41,
        topCompetitorPriceUSD: 18,
        topCompetitorMarketShare: 0.31,
      }, null, 2),
    },
    intervention: {
      id: 'mid-tier-pricing-launch',
      name: 'New $14/mo mid-tier launch',
      description: 'Introduce a third pricing tier at $14/mo (between Free and the existing $29/mo Pro), unlocking 60% of Pro features. Bundle with 90-day grandfathering for current Pro subs and a quarterly migration check-in. 6-month pilot before deciding to globalize.',
      durationValue: '6',
      durationUnit: 'months',
      adherence: '0.72',
    },
    signalsJson: JSON.stringify([
      { label: 'Free → Paid conversion', value: 0.034, unit: 'rate', recordedAt: '2026-04-01T00:00:00Z' },
      { label: 'Monthly churn', value: 0.038, unit: 'rate', recordedAt: '2026-04-01T00:00:00Z' },
      { label: 'NPS', value: 41, unit: 'score', recordedAt: '2026-04-01T00:00:00Z' },
    ], null, 2),
  },
};

function safeParseJson(value: string, fallback: unknown): unknown {
  if (!value || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function InterventionDemoCard({ onResult, onError, onRunStart }: InterventionDemoCardProps) {
  const [subject, setSubject] = useState<SubjectForm>(EMPTY_SUBJECT);
  const [intervention, setIntervention] = useState<InterventionForm>(EMPTY_INTERVENTION);
  const [signalsJson, setSignalsJson] = useState<string>('[]');
  const [running, setRunning] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const loadPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    setSubject(p.subject);
    setIntervention(p.intervention);
    setSignalsJson(p.signalsJson);
    setActivePreset(key);
  };

  const clearForm = () => {
    setSubject(EMPTY_SUBJECT);
    setIntervention(EMPTY_INTERVENTION);
    setSignalsJson('[]');
    setActivePreset(null);
  };

  const formIsValid = subject.id.trim().length > 0
    && subject.name.trim().length > 0
    && intervention.id.trim().length > 0
    && intervention.name.trim().length > 0
    && intervention.description.trim().length > 0;

  const handleRun = async () => {
    if (running || !formIsValid) return;
    const profile = safeParseJson(subject.profileJson, {}) as Record<string, unknown>;
    const signals = safeParseJson(signalsJson, []) as Array<Record<string, unknown>>;
    const subjectPayload = {
      id: subject.id.trim(),
      name: subject.name.trim(),
      profile: subject.description.trim()
        ? { ...profile, description: subject.description.trim() }
        : profile,
      signals,
      markers: [],
    };
    const durationValueNum = Number(intervention.durationValue);
    const adherenceNum = Number(intervention.adherence);
    const interventionPayload = {
      id: intervention.id.trim(),
      name: intervention.name.trim(),
      description: intervention.description.trim(),
      duration: Number.isFinite(durationValueNum) && durationValueNum > 0
        ? { value: durationValueNum, unit: intervention.durationUnit.trim() || 'weeks' }
        : undefined,
      adherenceProfile: Number.isFinite(adherenceNum)
        ? { expected: Math.max(0, Math.min(1, adherenceNum)) }
        : undefined,
    };

    setRunning(true);
    setElapsedSec(0);
    const startedAt = Date.now();
    const tick = window.setInterval(() => {
      setElapsedSec(Math.round((Date.now() - startedAt) / 1000));
    }, 500);

    onRunStart?.({
      subject: { id: subjectPayload.id, name: subjectPayload.name, profile: subjectPayload.profile },
      intervention: {
        id: interventionPayload.id,
        name: interventionPayload.name,
        description: interventionPayload.description,
        duration: interventionPayload.duration,
      },
    });

    try {
      const res = await fetch('/api/quickstart/simulate-intervention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subjectPayload,
          intervention: interventionPayload,
          options: { maxTurns: 2, seed: 11, costPreset: 'economy' },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error ?? `Digital twin run failed: HTTP ${res.status}`);
      }
      const body = await res.json() as { artifact: RunArtifact; durationMs: number };
      onResult(body.artifact);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      window.clearInterval(tick);
      setRunning(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.heading}>
        <h3 className={styles.title}>Run a digital twin</h3>
        <span className={styles.eyebrow}>any subject · any intervention</span>
      </div>
      <p className={styles.copy}>
        Define a subject (patient, market segment, jurisdiction, vehicle, anything) and an intervention to apply to it.
        Paracosm runs a real LLM-driven simulation across a five-department analysis team and returns a typed RunArtifact
        with the trajectory.
      </p>

      <div className={styles.presetRow}>
        <span className={styles.presetLabel}>Examples</span>
        {Object.entries(PRESETS).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            onClick={() => loadPreset(key)}
            className={`${styles.presetButton} ${activePreset === key ? styles.presetButtonActive : ''}`}
            disabled={running}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          onClick={clearForm}
          className={styles.presetClear}
          disabled={running}
        >
          Clear
        </button>
      </div>
      {activePreset && (
        <p className={styles.presetBlurb}>{PRESETS[activePreset].blurb}</p>
      )}

      <div className={styles.formGrid}>
        <fieldset className={styles.formCell} disabled={running}>
          <legend className={styles.formLegend}>Subject</legend>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>ID</span>
            <input
              type="text"
              value={subject.id}
              onChange={(e) => setSubject((s) => ({ ...s, id: e.target.value }))}
              placeholder="patient-001"
              className={styles.input}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              type="text"
              value={subject.name}
              onChange={(e) => setSubject((s) => ({ ...s, name: e.target.value }))}
              placeholder="Maria Chen"
              className={styles.input}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Description</span>
            <textarea
              value={subject.description}
              onChange={(e) => setSubject((s) => ({ ...s, description: e.target.value }))}
              placeholder="Age, key attributes, baseline state."
              className={styles.textarea}
              rows={3}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Profile (JSON)</span>
            <textarea
              value={subject.profileJson}
              onChange={(e) => setSubject((s) => ({ ...s, profileJson: e.target.value }))}
              placeholder='{"age": 58, "bmi": 31}'
              className={`${styles.textarea} ${styles.mono}`}
              rows={5}
              spellCheck={false}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Signals (JSON)</span>
            <textarea
              value={signalsJson}
              onChange={(e) => setSignalsJson(e.target.value)}
              placeholder='[{"label":"HbA1c","value":7.8,"unit":"%"}]'
              className={`${styles.textarea} ${styles.mono}`}
              rows={4}
              spellCheck={false}
            />
          </label>
        </fieldset>

        <fieldset className={styles.formCell} disabled={running}>
          <legend className={styles.formLegend}>Intervention</legend>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>ID</span>
            <input
              type="text"
              value={intervention.id}
              onChange={(e) => setIntervention((iv) => ({ ...iv, id: e.target.value }))}
              placeholder="semaglutide-12wk"
              className={styles.input}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              type="text"
              value={intervention.name}
              onChange={(e) => setIntervention((iv) => ({ ...iv, name: e.target.value }))}
              placeholder="12-week semaglutide protocol"
              className={styles.input}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Description</span>
            <textarea
              value={intervention.description}
              onChange={(e) => setIntervention((iv) => ({ ...iv, description: e.target.value }))}
              placeholder="What is being applied, by whom, with what monitoring."
              className={styles.textarea}
              rows={5}
            />
          </label>
          <div className={styles.fieldRow}>
            <label className={`${styles.field} ${styles.fieldThird}`}>
              <span className={styles.fieldLabel}>Duration</span>
              <input
                type="number"
                min="1"
                value={intervention.durationValue}
                onChange={(e) => setIntervention((iv) => ({ ...iv, durationValue: e.target.value }))}
                className={styles.input}
              />
            </label>
            <label className={`${styles.field} ${styles.fieldThird}`}>
              <span className={styles.fieldLabel}>Unit</span>
              <select
                value={intervention.durationUnit}
                onChange={(e) => setIntervention((iv) => ({ ...iv, durationUnit: e.target.value }))}
                className={styles.input}
              >
                <option value="days">days</option>
                <option value="weeks">weeks</option>
                <option value="months">months</option>
                <option value="quarters">quarters</option>
                <option value="years">years</option>
              </select>
            </label>
            <label className={`${styles.field} ${styles.fieldThird}`}>
              <span className={styles.fieldLabel}>Adherence</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={intervention.adherence}
                onChange={(e) => setIntervention((iv) => ({ ...iv, adherence: e.target.value }))}
                className={styles.input}
              />
            </label>
          </div>
        </fieldset>
      </div>

      <div className={styles.actions}>
        <button onClick={handleRun} disabled={running || !formIsValid} className={styles.button}>
          {running ? 'Running…' : 'Run digital twin'}
        </button>
        {running ? (
          <span className={styles.timer} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            {elapsedSec}s elapsed · 2 turns × LLM decisions, typically 40-90s
          </span>
        ) : (
          <span className={styles.helper}>2 turns · seed 11 · economy preset</span>
        )}
      </div>
    </div>
  );
}
