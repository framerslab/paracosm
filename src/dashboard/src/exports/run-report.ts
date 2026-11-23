import type { RunArtifact, RunProvenance } from '../../../engine/schema/index.js';
import { makeProvenanceXmp } from './media-metadata';

export const exportProvenance = (existing?: RunProvenance | null, verdict?: Record<string, unknown> | null): RunProvenance => ({
  aiGenerated: true,
  generator: 'paracosm',
  models: {
    ...existing?.models,
    ...(typeof verdict?.verdictModel === 'string' && verdict.verdictModel ? { verdict: verdict.verdictModel } : {}),
  },
});

interface Passage {
  heading: string;
  text: string;
  authored: boolean;
}

function passages(artifact: RunArtifact): Passage[] {
  const report: Passage[] = [];
  for (const decision of artifact.decisions ?? []) {
    for (const [field, heading] of [['choice', 'Decision'], ['rationale', 'Rationale'], ['reasoning', 'Reasoning']] as const) {
      const text = decision[field];
      if (text) report.push({ heading, text, authored: decision.aiWrittenFields?.includes(field) ?? false });
    }
  }
  for (const note of artifact.specialistNotes ?? []) {
    report.push({ heading: note.domain, text: note.summary, authored: note.aiWrittenFields?.includes('summary') ?? false });
    for (const risk of note.detail?.risks ?? []) {
      report.push({ heading: 'Risk', text: risk.description, authored: note.aiWrittenFields?.includes('risks') ?? false });
    }
    for (const action of note.detail?.recommendedActions ?? []) {
      report.push({ heading: 'Recommendation', text: action, authored: note.aiWrittenFields?.includes('recommendedActions') ?? false });
    }
  }
  return report;
}

function reportTitle(artifact: RunArtifact): string {
  const actor = artifact.decisions?.find(decision => decision.actor)?.actor;
  return [artifact.metadata.scenario.name, actor].filter(Boolean).join(' · ');
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function makeRunReportHtml(artifact: RunArtifact): string {
  const provenance = exportProvenance(artifact.provenance);
  const title = escapeHtml(reportTitle(artifact));
  const sections = passages(artifact).map(({ heading, text, authored }) =>
    `<section><h2>${escapeHtml(heading)}</h2><p${authored ? ' data-ai-generated="true"' : ''}>${escapeHtml(text)}${authored ? ' <span>AI-written</span>' : ''}</p></section>`,
  );
  const embedded = JSON.stringify({ provenance }).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="ai-generated-content" content="partial"><script type="application/json" id="paracosm-provenance">${embedded}</script></head><body><main><h1>${title}</h1>${sections.join('')}</main></body></html>`;
}

export async function makeRunReportPdf(artifact: RunArtifact): Promise<Uint8Array<ArrayBuffer>> {
  const { PDFDocument, PDFName, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const provenance = exportProvenance(artifact.provenance);
  const encoder = new TextEncoder();
  const xml = doc.context.stream(encoder.encode(makeProvenanceXmp(provenance)), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xml));
  const attachment = {
    metadata: artifact.metadata,
    provenance,
    decisions: artifact.decisions?.map(({ time, actor, choice, rationale, reasoning, outcome, aiWrittenFields }) =>
      ({ time, actor, choice, rationale, reasoning, outcome, aiWrittenFields })),
    specialistNotes: artifact.specialistNotes?.map(({ domain, summary, detail, aiWrittenFields }) =>
      ({ domain, summary, aiWrittenFields, detail: { recommendedActions: detail?.recommendedActions, risks: detail?.risks } })),
  };
  await doc.attach(encoder.encode(JSON.stringify(attachment)), 'run.json', { mimeType: 'application/json' });

  const size = 12;
  const advance = 18;
  let page = doc.addPage();
  let y = page.getHeight() - 54;
  const maxWidth = page.getWidth() - 108;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontStyle = `${size * 2}px sans-serif`;
  if (ctx) ctx.font = fontStyle;

  const draw = async (line: string) => {
    if (y < 54) {
      page = doc.addPage();
      y = page.getHeight() - 54;
    }
    if (line) {
      let encodable = true;
      try { font.encodeText(line); } catch { encodable = false; }
      if (encodable) page.drawText(line, { x: 54, y, size, font });
      else if (ctx) {
        canvas.width = Math.ceil(ctx.measureText(line).width) + 4;
        canvas.height = advance * 2;
        ctx.font = fontStyle;
        ctx.fillText(line, 2, size * 2 + 2);
        const png = await doc.embedPng(canvas.toDataURL('image/png'));
        page.drawImage(png, { x: 54, y: y - 6, width: canvas.width / 2, height: canvas.height / 2 });
      }
    }
    y -= advance;
  };

  const write = async (text: string) => {
    for (const paragraph of text.split(/\r?\n/)) {
      let line = '';
      for (const char of paragraph) {
        if (line && (ctx ? ctx.measureText(line + char).width / 2 : (line.length + 1) * size) > maxWidth) {
          await draw(line);
          line = '';
        }
        line += char;
      }
      await draw(line);
    }
  };
  await write(reportTitle(artifact));
  for (const { heading, text, authored } of passages(artifact)) {
    await draw('');
    await write(heading);
    await write(text);
    if (authored) await draw('AI-written');
  }
  return new Uint8Array(await doc.save());
}
