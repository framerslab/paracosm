import * as React from 'react';
import styles from './diff.module.scss';
import type { RunArtifact } from '../../../../../engine/schema/index.js';

export interface FingerprintDiffProps {
  artifacts: RunArtifact[];
}

export function FingerprintDiff({ artifacts }: FingerprintDiffProps): JSX.Element {
  const numericKeys = React.useMemo(() => collectNumericKeys(artifacts), [artifacts]);
  if (numericKeys.length === 0) {
    return (
      <section className={styles.diffSection} aria-label="Fingerprint comparison">
        <header className={styles.diffHead}>
          <h5 className={styles.diffTitle}>Fingerprint</h5>
        </header>
        <p className={styles.diffEmpty}>No numeric fingerprint fields available.</p>
      </section>
    );
  }
  const cssVars = { gridTemplateColumns: `repeat(${artifacts.length}, 1fr)` } as React.CSSProperties;
  return (
    <section className={styles.diffSection} aria-label="Fingerprint comparison">
      <header className={styles.diffHead}>
        <h5 className={styles.diffTitle}>Fingerprint</h5>
      </header>
      {numericKeys.map((key) => (
        <div key={key} className={styles.fingerprintRow}>
          <span className={styles.fingerprintLabel}>{key}</span>
          <div className={styles.fingerprintBars} style={cssVars}>
            {artifacts.map((a, i) => {
              const v = readNumeric(a.fingerprint?.[key]);
              const pct = Math.max(0, Math.min(100, v * 100));
              return (
                <div
                  key={i}
                  className={styles.fingerprintBar}
                  aria-label={`${key}: ${v.toFixed(2)}`}
                >
                  <div className={styles.fingerprintBarFill} style={{ width: `${pct}%` }} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

function collectNumericKeys(artifacts: RunArtifact[]): string[] {
  const keys = new Set<string>();
  for (const a of artifacts) {
    if (!a.fingerprint) continue;
    for (const [k, v] of Object.entries(a.fingerprint)) {
      if (typeof v === 'number' && Number.isFinite(v)) keys.add(k);
    }
  }
  return [...keys].sort();
}

function readNumeric(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
}
