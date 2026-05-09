/**
 * Onboarding guide rendered above the Studio drop zone. Explains how to
 * obtain a RunArtifact JSON for a user landing here cold, links over to
 * the Settings tab to configure a scenario, and tucks a fully-formed
 * example artifact behind an inline `<details>` so the page stays short.
 *
 * @module paracosm/dashboard/studio/StudioGuide
 */
import * as React from 'react';
import styles from './StudioTab.module.scss';

const EXAMPLE_ARTIFACT = `{
  "schemaVersion": "1.0.0",
  "artifactId": "01J2A8R0K9P3F7HXC4ZDM3WQYV",
  "scenario": {
    "id": "frontier-ai-lab",
    "name": "Frontier AI Lab",
    "departments": 4
  },
  "setup": {
    "turns": 20,
    "seed": 42,
    "startTime": "2025-04-30T09:00:00Z",
    "timePerTurn": 86400,
    "population": 18
  },
  "actor": {
    "kind": "openai",
    "model": "gpt-4o-mini"
  },
  "events": [
    {
      "turn": 1,
      "kind": "actor.action",
      "actorId": "alice",
      "summary": "Reviews Q1 budget; flags compute overrun",
      "ts": "2025-04-30T09:00:00Z"
    },
    {
      "turn": 1,
      "kind": "actor.message",
      "actorId": "bob",
      "to": ["alice"],
      "text": "Confirming the H100 cluster spend. We are 18% over plan."
    }
  ],
  "results": {
    "kpis": { "morale": 0.74, "throughput": 0.61 },
    "completed": true
  },
  "verdict": {
    "kind": "judge.verdict",
    "label": "plausible",
    "score": 0.82,
    "rationale": "Roles consistent with departmental authority; arithmetic checks out."
  }
}`;

function openSettings(event: React.MouseEvent<HTMLAnchorElement>) {
  // SPA-style navigation: update the URL search params, then fire a
  // synthetic popstate so App.tsx's existing listener swaps the active
  // tab without a full page reload. Falls back to the `<a href>` for
  // right-click "open in new tab" and no-JS environments.
  event.preventDefault();
  const url = new URL(window.location.href);
  url.searchParams.set('tab', 'settings');
  url.searchParams.delete('sub');
  window.history.replaceState({}, '', url.toString());
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function StudioGuide(): JSX.Element {
  return (
    <section className={styles.guide} aria-label="How to author a RunArtifact JSON">
      <div className={styles.guideHead}>
        <h3 className={styles.guideTitle}>How to get a RunArtifact JSON</h3>
        <p className={styles.guideSub}>
          Studio takes a deterministic Paracosm <code>RunArtifact</code> — the JSON that a single sim run produces — and lets you inspect, promote to the Library, branch, or compare. Four steps to author one.
        </p>
      </div>

      <ol className={styles.guideSteps}>
        <li>
          <strong>Configure a scenario in Settings.</strong> Pick a built-in (Frontier AI Lab, Submarine, Corporate Quarterly, T2D Protocol) or load your own. Set turns, seed, population, time-per-turn.
        </li>
        <li>
          <strong>Run the sim.</strong> Switch to the Sim tab, hit Run. The runtime emits events deterministically, the actor LLM produces dialogue and decisions, and the judge attaches a verdict at the end.
        </li>
        <li>
          <strong>Download the artifact.</strong> Sim output panel has a Save button — that JSON is the RunArtifact. You can also produce one from the CLI: <code>paracosm run scenarios/frontier-ai-lab.json --turns 20 --out run.json</code>.
        </li>
        <li>
          <strong>Drop it in the zone below.</strong> Single artifact or a bundle (array of artifacts, e.g. for branch comparisons). Max 10&nbsp;MB.
        </li>
      </ol>

      <div className={styles.guideCtaRow}>
        <a
          href="?tab=settings"
          onClick={openSettings}
          className={styles.guideCta}
        >
          Open Settings →
        </a>
        <a
          href="https://github.com/framersai/paracosm/blob/master/docs/COOKBOOK.md"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.guideCtaSecondary}
        >
          Read the cookbook
        </a>
        <a
          href="https://github.com/framersai/paracosm/tree/master/scenarios"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.guideCtaSecondary}
        >
          Browse example scenarios
        </a>
      </div>

      <details className={styles.guideExample}>
        <summary>Show an example RunArtifact</summary>
        <pre className={styles.guideExampleCode}>
          <code>{EXAMPLE_ARTIFACT}</code>
        </pre>
        <p className={styles.guideExampleNote}>
          Real artifacts include the full event log, the per-turn snapshot of every actor, KPIs, and the judge verdict. The shape matches the <code>RunArtifact</code> Zod schema in <code>schema/index.ts</code>; bundles are a JSON array of artifacts.
        </p>
      </details>
    </section>
  );
}
