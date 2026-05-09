export type ScenarioReportSection =
  | 'crisis'
  | 'departments'
  | 'decision'
  | 'outcome'
  | 'quotes'
  | 'causality';

export type EventReportSection = Exclude<ScenarioReportSection, 'quotes'>;
export type FooterReportSection = Extract<ScenarioReportSection, 'quotes'>;
export type ReportArtifact =
  | 'timeline'
  | 'verdict'
  | 'trajectory'
  | 'cost'
  | 'toolbox'
  | 'references';

export interface BuildReportSectionsInput {
  configuredSections: ScenarioReportSection[];
  hasQuotes: boolean;
  hasCausality: boolean;
  hasVerdict: boolean;
  hasTrajectories: boolean;
  hasCost: boolean;
  hasToolbox: boolean;
  hasReferences: boolean;
}

export interface ReportSectionPlan {
  /** The scenario-authored focus order, with a stable fallback. */
  focusSections: ScenarioReportSection[];
  /** Actual event-body sections we render for this run. */
  eventSections: EventReportSection[];
  /** Actual footer sections we render for this run. */
  footerSections: FooterReportSection[];
  /** Top-level run artifacts present outside the turn body. */
  artifacts: ReportArtifact[];
}

export const REPORT_FOCUS_LABELS: Record<ScenarioReportSection, string> = {
  crisis: 'Crisis',
  departments: 'Department analysis',
  decision: 'Decision',
  outcome: 'Outcome',
  quotes: 'Agent voices',
  causality: 'Causality',
};

export const REPORT_ARTIFACT_LABELS: Record<ReportArtifact, string> = {
  timeline: 'Turn timeline',
  verdict: 'Verdict',
  trajectory: 'Commander arcs',
  cost: 'Cost breakdown',
  toolbox: 'Forged toolbox',
  references: 'References',
};

const DEFAULT_FOCUS_SECTIONS: ScenarioReportSection[] = [
  'crisis',
  'departments',
  'decision',
  'outcome',
];

const DEFAULT_EVENT_SECTIONS: EventReportSection[] = [
  'crisis',
  'departments',
  'decision',
  'outcome',
  'causality',
];

function isScenarioReportSection(value: string): value is ScenarioReportSection {
  return value === 'crisis'
    || value === 'departments'
    || value === 'decision'
    || value === 'outcome'
    || value === 'quotes'
    || value === 'causality';
}

function isEventReportSection(value: ScenarioReportSection): value is EventReportSection {
  return value !== 'quotes';
}

function uniqueSections(sections: string[] | undefined | null): ScenarioReportSection[] {
  const deduped: ScenarioReportSection[] = [];
  // Defensive default. ScenarioPackage.ui.reportSections is typed as
  // required, but the compiler's index.ts:332 spread (`...(json.ui ?? {})`)
  // can produce a `ui` without `reportSections` when the seed draft
  // lacks one. Without this guard the for-of throws "is not iterable"
  // inside the REPORTS useMemo, the whole REPORTS tab unmounts via the
  // root error path, and the dashboard's tab bar disappears with it.
  // Compiler is being fixed in parallel; this stays as defense in depth.
  for (const section of sections ?? []) {
    if (!isScenarioReportSection(section) || deduped.includes(section)) continue;
    deduped.push(section);
  }
  return deduped;
}

export function buildReportSections(input: BuildReportSectionsInput): ReportSectionPlan {
  const focusSections = uniqueSections(input.configuredSections);
  const stableFocus = focusSections.length > 0 ? focusSections : DEFAULT_FOCUS_SECTIONS;
  const eventSections = stableFocus.filter(isEventReportSection);

  for (const section of DEFAULT_EVENT_SECTIONS) {
    if (section === 'causality' && !input.hasCausality) continue;
    if (!eventSections.includes(section)) eventSections.push(section);
  }

  const footerSections: FooterReportSection[] = input.hasQuotes ? ['quotes'] : [];
  const artifacts: ReportArtifact[] = ['timeline'];

  if (input.hasVerdict) artifacts.push('verdict');
  if (input.hasTrajectories) artifacts.push('trajectory');
  if (input.hasCost) artifacts.push('cost');
  if (input.hasToolbox) artifacts.push('toolbox');
  if (input.hasReferences) artifacts.push('references');

  return {
    focusSections: stableFocus,
    eventSections,
    footerSections,
    artifacts,
  };
}
