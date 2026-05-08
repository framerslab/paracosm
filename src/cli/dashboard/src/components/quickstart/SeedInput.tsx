/**
 * Quickstart seed picker: paste text, URL, or PDF upload. Emits the
 * resolved seed text via `onSeedReady` when the user confirms. The
 * parent orchestrator handles compile + run dispatch.
 *
 * @module paracosm/dashboard/quickstart/SeedInput
 */
import { useState, useRef, useCallback } from 'react';
import { validateSeedText, validateSeedUrl } from './QuickstartView.helpers';
import { extractPdfText } from './pdf-extract';
import { ViewAsCodePanel } from './ViewAsCodePanel';
import { LoadedScenarioCTA } from './LoadedScenarioCTA';
import { QUICKSTART_TEMPLATES } from './quickstart-templates';
import styles from './SeedInput.module.scss';

export interface SeedInputProps {
  onSeedReady: (payload: { seedText: string; sourceUrl?: string; domainHint?: string; actorCount?: number }) => void;
  /** Optional: fires when the user clicks the LoadedScenarioCTA's run
   *  button. Parent decides whether to fast-path through `/setup`
   *  (presets present) or route through actor-generation. When omitted
   *  the CTA does not render — preserves existing tests for callers
   *  that don't surface a loaded scenario. */
  onLoadedScenarioRunStart?: (actorCount: number) => void;
  disabled?: boolean;
}

type Tab = 'paste' | 'url' | 'pdf';

/**
 * Read the `?prompt=` query param off the current URL, if any. Lets the
 * marketing landing page hand off a sample question into Quickstart's
 * paste tab without an extra navigation step. Returns '' off the
 * happy path so the regular empty-state still renders.
 */
function readPromptFromUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = new URLSearchParams(window.location.search).get('prompt');
    return raw ? raw.trim() : '';
  } catch {
    return '';
  }
}

export function SeedInput({ onSeedReady, onLoadedScenarioRunStart, disabled = false }: SeedInputProps) {
  const [tab, setTab] = useState<Tab>('paste');
  const [seedText, setSeedText] = useState(readPromptFromUrl);
  const [urlInput, setUrlInput] = useState('');
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [domainHint, setDomainHint] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  // Actor count: how many parallel actors run against this scenario.
  // Default 2: this dashboard is built around the side-by-side 2-actor
  // comparison surface (TurnGrid, DivergenceRail, ActorBar). 3+ actors
  // run cleanly through the API + CLI but the visual story collapses
  // here — a richer N-actor dashboard is on the Pro/Enterprise roadmap.
  // Cap 300 mirrors GenerateLeadersSchema (raised from 50 once the
  // batch runner gained real concurrency limiting via
  // economics.batch.maxConcurrency). Each actor is ~$0.30 LLM spend;
  // the cost preview surfaces the running total below the slider.
  const [actorCount, setActorCount] = useState(2);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(() => {
    const trimmedSeed = seedText.trim();
    const validation = validateSeedText(trimmedSeed);
    if (!validation.ok) {
      setError(
        validation.reason === 'too-short' ? 'Paste at least 200 characters of source material.' :
        validation.reason === 'too-long' ? 'Source material exceeds 50 000 characters.' :
        'Source material is empty.',
      );
      return;
    }
    setError(null);
    onSeedReady({
      seedText: trimmedSeed,
      sourceUrl,
      domainHint: domainHint.trim() || undefined,
      actorCount,
    });
  }, [seedText, sourceUrl, domainHint, actorCount, onSeedReady]);

  const fetchUrl = useCallback(async () => {
    const validation = validateSeedUrl(urlInput);
    if (!validation.ok) { setError(validation.error); return; }
    setFetching(true);
    setError(null);
    try {
      const res = await fetch('/api/quickstart/fetch-seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: validation.url.toString() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        setError(body.error ?? `Fetch failed: HTTP ${res.status}`);
        return;
      }
      const data = await res.json() as { text: string; sourceUrl?: string; truncated?: boolean };
      setSeedText(data.text);
      setSourceUrl(data.sourceUrl ?? validation.url.toString());
      setTab('paste');
    } catch (err) {
      // Network-level failures (DNS, CORS, TLS) reach this branch.
      // Server-supplied error messages went through the body.error
      // path above, so anything here is a transport problem.
      const raw = (err as Error)?.message ?? String(err);
      const msg = /Failed to fetch|NetworkError|ERR_/i.test(raw)
        ? "Couldn't reach the server. Check your connection and try again."
        : `URL fetch failed: ${raw}`;
      setError(msg);
    } finally {
      setFetching(false);
    }
  }, [urlInput]);

  const handlePdfUpload = useCallback(async (file: File) => {
    const MAX_PDF_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_PDF_BYTES) {
      setError('PDF exceeds 10 MB limit.');
      return;
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError(`File is not a PDF: ${file.name}`);
      return;
    }
    setFetching(true);
    setError(null);
    try {
      const { text, truncated } = await extractPdfText(file);
      setSeedText(truncated ? `${text}\n\n[Truncated to first 50 KB.]` : text);
      setSourceUrl(undefined);
      setTab('paste');
    } catch (err) {
      // Map pdf.js exceptions to actionable copy. The raw stringified
      // exception (e.g. 'InvalidPDFException: Invalid PDF structure'
      // or 'Setting up fake worker failed') reads as failure-by-bug
      // even when the cause is just "this is a scanned PDF" or "the
      // file is corrupted". Surface the recovery action instead.
      const code = (err as Error & { code?: string })?.code;
      const raw = String((err as Error)?.message ?? err);
      let msg: string;
      if (code === 'PDF_NO_TEXT') {
        msg = 'No text found in this PDF. It looks like a scanned image — try a text-based PDF, or paste the content into WRITE.';
      } else if (/InvalidPDFException|invalid pdf|corrupt/i.test(raw)) {
        msg = 'This PDF appears to be corrupted or password-protected. Try a different file or paste the text directly.';
      } else if (/worker|GlobalWorkerOptions/i.test(raw)) {
        msg = `Couldn't load the PDF parser (${raw}). Try a different file, or paste the text into WRITE.`;
      } else {
        msg = `Couldn't read this PDF (${raw}). Try paste-text or a different file.`;
      }
      setError(msg);
    } finally {
      setFetching(false);
    }
  }, []);

  // Tab id stays 'paste' for backward compat with existing telemetry
  // and tests; the visible label is "WRITE" so the textarea reads as
  // an invitation to type, not just paste. Multiple users called this
  // out as confusing — "Paste" implied the only valid input was
  // pre-existing text from a clipboard.
  const TAB_LABELS: Record<Tab, string> = { paste: 'WRITE', url: 'URL', pdf: 'PDF' };
  // True once the textarea (or a fetched URL / extracted PDF) has
  // enough content that submitting it would actually compile a new
  // scenario. We use this to demote the loaded-scenario CTA so the
  // user does not click it and silently discard the seed they just
  // typed — the bug we kept seeing where someone pasted a hurricane
  // scenario, hit the orange button, and watched the previously
  // active AI-lab scenario run instead.
  const hasPendingSeed = seedText.trim().length >= 200;

  return (
    <div className={styles.seedInput}>
      {onLoadedScenarioRunStart && (
        <>
          {hasPendingSeed && (
            <p className={styles.pendingSeedNotice} role="status" aria-live="polite">
              You have draft seed text below. Submit it to compile a new scenario, or clear it to run the loaded one.
            </p>
          )}
          <LoadedScenarioCTA
            onRunStart={onLoadedScenarioRunStart}
            disabled={disabled || fetching || hasPendingSeed}
          />
          <div className={styles.dividerWrap}>
            <span className={styles.dividerLine} aria-hidden="true" />
            <span>or paste a new scenario</span>
            <span className={styles.dividerLine} aria-hidden="true" />
          </div>
        </>
      )}
      <label className={styles.templatePicker}>
        <span className={styles.templatePickerLabel}>Try a template</span>
        <select
          className={styles.templatePickerSelect}
          value=""
          disabled={disabled}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            const template = QUICKSTART_TEMPLATES.find(t => t.id === id);
            if (!template) return;
            setTab('paste');
            setSeedText(template.seedText);
            setError(null);
            // Reset to placeholder so the same template can be picked
            // again later (replacing the textarea content) without the
            // select getting stuck on a previously-resolved value.
            e.target.value = '';
          }}
        >
          <option value="">Pick a sample scenario…</option>
          {QUICKSTART_TEMPLATES.map(t => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </label>
      <div className={styles.tabs} role="tablist">
        {(['paste', 'url', 'pdf'] as Tab[]).map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
            onClick={() => { setTab(t); setError(null); }}
            disabled={disabled}
            type="button"
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'paste' && (
        <textarea
          data-quickstart-seed
          className={styles.textarea}
          placeholder="Type or paste a brief, article, meeting notes, or any domain-specific source material (at least 200 characters)."
          value={seedText}
          onChange={e => setSeedText(e.target.value)}
          rows={6}
          disabled={disabled}
        />
      )}

      {tab === 'url' && (
        <div className={styles.urlRow}>
          <input
            type="url"
            className={styles.input}
            placeholder="https://example.com/article"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            disabled={disabled || fetching}
          />
          <button
            type="button"
            className={styles.fetchButton}
            onClick={fetchUrl}
            disabled={disabled || fetching || !urlInput}
          >
            {fetching ? 'Fetching...' : 'Fetch'}
          </button>
        </div>
      )}

      {tab === 'pdf' && (
        <div
          className={styles.dropZone}
          // The dashboard shell installs a window-level drop handler
          // (useDashboardDropZone) that auto-loads a dropped .json save
          // file from anywhere on the page and rejects everything else
          // with "Only .json simulation files supported." That handler
          // bails out when its hit-test lands inside an element marked
          // with this data attribute, so the PDF tab's local drop zone
          // wins for PDF drops without losing the global json-drop UX.
          data-paracosm-local-dropzone="pdf"
          onClick={() => { if (!disabled) fileInputRef.current?.click(); }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            if (disabled) return;
            const file = e.dataTransfer.files[0];
            if (file) handlePdfUpload(file);
          }}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          onKeyDown={e => {
            if (disabled) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handlePdfUpload(file);
            }}
            hidden
          />
          {fetching ? 'Extracting text...' : 'Drop a PDF or click to upload (max 10 MB, first 50 KB of text used)'}
        </div>
      )}

      <div className={styles.hint}>
        <label htmlFor="quickstart-domain-hint">Domain hint (optional)</label>
        <input
          id="quickstart-domain-hint"
          className={styles.input}
          type="text"
          placeholder='e.g., "clinical trial decision" or "startup growth"'
          value={domainHint}
          onChange={e => setDomainHint(e.target.value)}
          maxLength={80}
          disabled={disabled}
        />
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.charCount}>
        {seedText.length.toLocaleString()} / 50,000 characters
      </div>

      <div className={styles.actorCountRow}>
        <label htmlFor="quickstart-actor-count" className={styles.actorCountLabel}>
          Actors: <strong>{actorCount}</strong>
        </label>
        <input
          id="quickstart-actor-count"
          type="range"
          min={1}
          max={300}
          value={actorCount}
          onChange={(e) => setActorCount(parseInt(e.target.value, 10))}
          disabled={disabled}
          className={styles.actorCountSlider}
          aria-label="Number of parallel actors to run"
        />
        <span className={styles.actorCountPreview} aria-live="polite">
          ~${(0.10 + 0.30 * actorCount).toFixed(2)} · {wallTimeEstimate(actorCount)}
        </span>
      </div>

      <ViewAsCodePanel
        seedText={seedText}
        domainHint={domainHint}
        sourceUrl={sourceUrl}
        actorCount={actorCount}
        disabled={disabled}
      />

      <button
        type="button"
        className={styles.runButton}
        onClick={submit}
        disabled={disabled || seedText.trim().length < 200}
      >
        Generate + Run {actorCount} {actorCount === 1 ? 'Actor' : 'Actors'} (~${(0.10 + 0.30 * actorCount).toFixed(2)})
      </button>
    </div>
  );
}

/** Rough wall-time estimate for the cost-preview tile. The batch
 *  runner now respects `economics.batch.maxConcurrency` (default 8 on
 *  the balanced profile) so this models 8-actor batches landing
 *  sequentially rather than the old "3 in parallel, ~5 min per batch"
 *  shape. Compile/ground/actor-gen baseline holds at ~2 min. Returns
 *  a "X-Y min" range padded to a 1.5x ceiling. */
function wallTimeEstimate(count: number): string {
  if (count <= 0) return '—';
  const baselineMin = 2;
  const perBatchMin = 5;
  const batchSize = 8;
  const batches = Math.max(1, Math.ceil(count / batchSize));
  const lo = baselineMin + perBatchMin * batches;
  const hi = Math.ceil(lo * 1.5);
  return `${lo}–${hi} min`;
}
