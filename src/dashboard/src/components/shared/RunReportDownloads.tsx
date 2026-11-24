import * as React from 'react';
import { createContext, useContext, useMemo, useState } from 'react';
import type { RunArtifact, RunProvenance } from '../../../../engine/schema/index.js';
import { downloadBlob, downloadJson } from '../../download';
import { exportProvenance, makeRunReportHtml, makeRunReportPdf } from '../../exports/run-report';

void React;

export const RunExportProvenanceContext = createContext<RunProvenance | null>(null);

export function useRunExportProvenance(): RunProvenance {
  const provenance = useContext(RunExportProvenanceContext);
  return useMemo(() => exportProvenance(provenance), [provenance]);
}

export function RunReportDownloads({ artifact, filename, verdict }: {
  artifact: RunArtifact;
  filename: string;
  verdict?: Record<string, unknown> | null;
}) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(false);

  const download = async (format: 'json' | 'html' | 'pdf') => {
    setProcessing(true);
    setError(false);
    try {
      const marked = { ...artifact, provenance: exportProvenance(artifact.provenance) };
      if (format === 'json') downloadJson(JSON.stringify(marked, null, 2), `${filename}.json`);
      if (format === 'html') downloadBlob(new Blob([makeRunReportHtml(marked, verdict)], { type: 'text/html;charset=utf-8' }), `${filename}.html`);
      if (format === 'pdf') downloadBlob(new Blob([await makeRunReportPdf(marked, verdict)], { type: 'application/pdf' }), `${filename}.pdf`);
    } catch {
      setError(true);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <button type="button" disabled={processing} onClick={() => void download('json')}>Download JSON</button>
      <button type="button" disabled={processing} onClick={() => void download('html')}>Download HTML</button>
      <button type="button" disabled={processing} onClick={() => void download('pdf')}>Download PDF</button>
      {error && <span role="status">Could not download the report. Try again.</span>}
    </>
  );
}
