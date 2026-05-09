import { useState, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { emitScenarioUpdated, subscribeScenarioUpdates } from '../../scenario-sync';
import { buildScenarioCompileRequest } from './scenarioCompileRequest';
import { SETTINGS_LABEL_STYLE } from './shared/settingsStyles';
import styles from './ScenarioEditor.module.scss';

interface AdminConfig {
  adminWrite: boolean;
  memoryScenarios: string[];
}

interface CompileProgress {
  hook: string;
  status: string;
}

const EXAMPLE_SCENARIO = {
  id: 'my-scenario',
  version: '1.0.0',
  engineArchetype: 'closed_turn_based_settlement',
  labels: { name: 'My Scenario', shortName: 'custom', populationNoun: 'agents', settlementNoun: 'settlement', currency: 'credits' },
  theme: { primaryColor: '#6366f1', accentColor: '#818cf8', cssVariables: {} },
  setup: { defaultTurns: 8, defaultSeed: 100, defaultStartTime: 2040, defaultPopulation: 50, configurableSections: ['actors', 'departments', 'models'] },
  departments: [
    { id: 'operations', label: 'Operations', role: 'Operations Lead', icon: '', defaultModel: 'gpt-5.4-mini', instructions: 'You analyze operations.' },
    { id: 'research', label: 'Research', role: 'Head of Research', icon: '', defaultModel: 'gpt-5.4-mini', instructions: 'You analyze research.' },
  ],
  metrics: [{ id: 'population', label: 'Population', source: 'metrics.population', format: 'number' }],
  effects: { environmental: { morale: 0.08 }, resource: { morale: 0.05 } },
  ui: { headerMetrics: [{ id: 'population', format: 'number' }], tooltipFields: [], reportSections: ['crisis'], departmentIcons: {}, setupSections: ['actors'] },
  policies: { toolForging: { enabled: true }, liveSearch: { enabled: false, mode: 'off' }, bulletin: { enabled: true }, characterChat: { enabled: true }, sandbox: { timeoutMs: 10000, memoryMB: 128 } },
  presets: [],
};

export function ScenarioEditor() {
  const [adminConfig, setAdminConfig] = useState<AdminConfig>({ adminWrite: false, memoryScenarios: [] });
  const [jsonText, setJsonText] = useState('');
  const [parseError, setParseError] = useState('');
  const [seedText, setSeedText] = useState('');
  const [seedUrl, setSeedUrl] = useState('');
  const [webSearch, setWebSearch] = useState(true);
  const [maxSearches, setMaxSearches] = useState('5');
  const [compileProvider, setCompileProvider] = useState('');
  const [compileModel, setCompileModel] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [storing, setStoring] = useState(false);
  const [progress, setProgress] = useState<CompileProgress[]>([]);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/admin-config').then(r => r.json()).then(setAdminConfig).catch(() => {});
  }, []);

  // Auto-load the active scenario JSON into the editor on mount and when scenario changes
  const loadActiveIntoEditor = useCallback(() => {
    fetch('/scenario')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.id) {
          setJsonText(JSON.stringify(data, null, 2));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadActiveIntoEditor();
    return subscribeScenarioUpdates(window, loadActiveIntoEditor);
  }, [loadActiveIntoEditor]);

  // Validate JSON on change
  useEffect(() => {
    if (!jsonText.trim()) { setParseError(''); return; }
    try { JSON.parse(jsonText); setParseError(''); }
    catch (e) { setParseError(String(e).replace('SyntaxError: ', '')); }
  }, [jsonText]);

  const loadExample = () => setJsonText(JSON.stringify(EXAMPLE_SCENARIO, null, 2));

  const loadActiveScenario = useCallback(async () => {
    try {
      const res = await fetch('/scenario');
      const data = await res.json();
      setJsonText(JSON.stringify(data, null, 2));
      setResult({ success: true, message: `Loaded active scenario: ${data.labels?.name || data.id}` });
    } catch (err) { setResult({ success: false, message: `Failed to load: ${err}` }); }
  }, []);

  const importFile = () => fileInputRef.current?.click();

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setJsonText(text);
      try { JSON.parse(text); setResult({ success: true, message: `Imported ${file.name} (${(file.size / 1024).toFixed(1)}KB)` }); }
      catch { setResult({ success: false, message: `Imported ${file.name} but JSON is invalid` }); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const exportFile = () => {
    if (!jsonText.trim()) return;
    try {
      const parsed = JSON.parse(jsonText);
      const name = parsed.id || 'scenario';
      const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${name}.json`; a.click();
      URL.revokeObjectURL(url);
      setResult({ success: true, message: `Exported ${name}.json` });
    } catch { setResult({ success: false, message: 'Fix JSON errors before exporting' }); }
  };

  const storeInMemory = useCallback(async () => {
    if (!jsonText.trim() || parseError) return;
    setStoring(true);
    try {
      const scenario = JSON.parse(jsonText);
      const res = await fetch('/scenario/store', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, saveToDisk: false }),
      });
      const data = await res.json();
      if (data.stored) {
        emitScenarioUpdated(window);
        setResult({
          success: true,
          message: data.switchable
            ? `Stored "${data.id}" in memory and added it to the scenario selector.`
            : `Stored "${data.id}" as draft JSON in memory. Compile it to make it runnable and switchable.`,
        });
        setAdminConfig(prev => ({ ...prev, memoryScenarios: [...new Set([...prev.memoryScenarios, data.id])] }));
      } else {
        setResult({ success: false, message: data.error || 'Store failed' });
      }
    } catch (err) { setResult({ success: false, message: String(err) }); }
    setStoring(false);
  }, [jsonText, parseError]);

  const saveToDisk = useCallback(async () => {
    if (!jsonText.trim() || parseError || !adminConfig.adminWrite) return;
    try {
      const scenario = JSON.parse(jsonText);
      const res = await fetch('/scenario/store', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, saveToDisk: true }),
      });
      const data = await res.json();
      if (data.savedToDisk) {
        emitScenarioUpdated(window);
        setResult({
          success: true,
          message: data.switchable
            ? `Saved "${data.id}" to disk at scenarios/${data.id}.json and loaded it into the live scenario catalog.`
            : `Saved "${data.id}" draft JSON to disk at scenarios/${data.id}.json. Compile it to make it runnable after restart.`,
        });
      } else {
        setResult({ success: false, message: data.error || 'Disk write not enabled (ADMIN_WRITE=false)' });
      }
    } catch (err) { setResult({ success: false, message: String(err) }); }
  }, [jsonText, parseError, adminConfig.adminWrite]);

  const compile = useCallback(async () => {
    if (!jsonText.trim() || parseError) return;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(jsonText); }
    catch { setResult({ success: false, message: 'Fix JSON errors before compiling' }); return; }

    setCompiling(true);
    setProgress([]);
    setResult(null);

    try {
      const body = buildScenarioCompileRequest({
        scenario: parsed,
        seedText,
        seedUrl,
        webSearch,
        maxSearches,
        provider: compileProvider,
        model: compileModel,
      });

      const res = await fetch('/compile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.hook) {
                setProgress(prev => {
                  const idx = prev.findIndex(p => p.hook === data.hook);
                  if (idx >= 0) { const u = [...prev]; u[idx] = data; return u; }
                  return [...prev, data];
                });
              }
              if (data.id) {
                emitScenarioUpdated(window);
                setResult({ success: true, message: `Compiled: ${data.id} (${data.departments} departments, ${data.hooks} hooks). Go to Settings to configure actors and launch.` });
              }
              if (data.error) setResult({ success: false, message: data.error });
            } catch {}
          }
        }
      }
    } catch (err) { setResult({ success: false, message: String(err) }); }
    setCompiling(false);
  }, [jsonText, parseError, seedText, seedUrl, webSearch, maxSearches, compileProvider, compileModel]);

  const lineCount = jsonText.split('\n').length;
  const byteSize = new Blob([jsonText]).size;

  return (
    <div className={styles.card}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Scenario Editor</h3>
          <p className={styles.lead}>
            Write or import a scenario JSON draft. Add seed text or a URL to ground it, then compile or export.
            {!adminConfig.adminWrite && ' Disk saves are disabled on this instance.'}
          </p>
        </div>
        <div className={styles.btnRow}>
          <button onClick={loadActiveScenario} className={[styles.btn, styles.amber].join(' ')} aria-label="Load active scenario JSON">Load Active</button>
          <button onClick={loadExample} className={styles.btn} aria-label="Load example scenario">Template</button>
          <button onClick={importFile} className={styles.btn} aria-label="Import JSON file">Import</button>
          <button onClick={exportFile} className={styles.btn} disabled={!jsonText.trim() || !!parseError} aria-label="Export as JSON file">Export</button>
          <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={handleFileImport} className={styles.fileInput} />
        </div>
      </div>

      {/* Editor */}
      <div className={styles.editorWrap}>
        <textarea
          ref={editorRef}
          value={jsonText}
          onChange={e => setJsonText(e.target.value)}
          placeholder='{\n  "id": "my-scenario",\n  "labels": { "name": "My World" },\n  "departments": [...]\n}'
          spellCheck={false}
          aria-label="Scenario JSON editor"
          className={styles.editor}
        />
        {/* Status bar */}
        <div
          className={styles.statusBar}
          style={{ '--status-color': parseError ? 'var(--rust)' : 'var(--text-3)' } as CSSProperties}
        >
          <span>{parseError || (jsonText.trim() ? 'Valid JSON' : 'Empty')}</span>
          <span>{lineCount} lines, {(byteSize / 1024).toFixed(1)}KB</span>
        </div>
      </div>

      {/* Seed enrichment */}
      <details className={styles.seedDetails}>
        <summary className={styles.seedSummary}>
          Seed Enrichment (optional)
        </summary>
        <div className={styles.seedBody}>
          <div>
            <label style={SETTINGS_LABEL_STYLE}>Seed Text</label>
            <textarea
              value={seedText}
              onChange={e => setSeedText(e.target.value)}
              placeholder="Paste a prompt, notes, a brief, or source text to turn into research facts and category mapping."
              className={styles.textarea}
            />
          </div>
          <div>
            <label style={SETTINGS_LABEL_STYLE}>Seed URL (fetched via Firecrawl)</label>
            <input value={seedUrl} onChange={e => setSeedUrl(e.target.value)} placeholder="https://example.com/article" className={styles.input} />
          </div>
          <div>
            <label style={SETTINGS_LABEL_STYLE}>Max Web Searches</label>
            <input
              value={maxSearches}
              onChange={e => setMaxSearches(e.target.value)}
              inputMode="numeric"
              placeholder="5"
              className={styles.input}
            />
          </div>
          <div>
            <label style={SETTINGS_LABEL_STYLE}>Compile Provider Override</label>
            <input
              value={compileProvider}
              onChange={e => setCompileProvider(e.target.value)}
              placeholder="anthropic or openai (optional)"
              className={styles.input}
            />
          </div>
          <div>
            <label style={SETTINGS_LABEL_STYLE}>Compile Model Override</label>
            <input
              value={compileModel}
              onChange={e => setCompileModel(e.target.value)}
              placeholder="gpt-5.4-mini, claude-sonnet-4-6, etc. (optional)"
              className={styles.input}
            />
          </div>
          <label className={styles.checkboxLabel}>
            <input type="checkbox" checked={webSearch} onChange={e => setWebSearch(e.target.checked)} />
            Web search enrichment (requires Serper/Tavily/Firecrawl API keys)
          </label>
          <p className={styles.fineprint}>
            If both seed text and a seed URL are provided, the URL takes precedence and the compiler ingests the fetched page.
          </p>
        </div>
      </details>

      {/* Compile progress */}
      {progress.length > 0 && (
        <div className={styles.progressWrap}>
          {progress.map(p => (
            <div key={p.hook} className={styles.progressRow}>
              <span>{p.status === 'done' ? '✔' : p.status === 'generating' ? '⏳' : p.status === 'cached' ? '✔' : '•'}</span>
              <span>{p.hook}</span>
              <span className={styles.progressStatus}>{p.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Result message */}
      {result && (
        <div
          className={styles.result}
          style={{
            '--result-color': result.success ? 'var(--green)' : 'var(--rust)',
            '--result-bg': result.success ? 'rgba(106,173,72,.06)' : 'rgba(224,101,48,.06)',
          } as CSSProperties}
        >
          {result.message}
        </div>
      )}

      {/* Actions */}
      <div className={styles.actions}>
        <button
          onClick={storeInMemory}
          disabled={!jsonText.trim() || !!parseError || storing}
          className={styles.actionBtn}
          aria-label="Store scenario in memory"
        >
          {storing ? 'Storing...' : 'Store in Memory'}
        </button>
        <button
          onClick={compile}
          disabled={!jsonText.trim() || !!parseError || compiling}
          className={[styles.actionBtn, styles.primary].join(' ')}
          aria-label="Compile scenario"
        >
          {compiling ? 'Compiling...' : 'Compile Scenario'}
        </button>
        {adminConfig.adminWrite && (
          <button
            onClick={saveToDisk}
            disabled={!jsonText.trim() || !!parseError}
            className={[styles.actionBtn, styles.amber].join(' ')}
            aria-label="Save scenario to disk"
          >
            Save to Disk
          </button>
        )}
        <span className={styles.spacer} />
        {adminConfig.memoryScenarios.length > 0 && (
          <span className={styles.memCount}>
            {adminConfig.memoryScenarios.length} in memory
          </span>
        )}
      </div>
    </div>
  );
}
