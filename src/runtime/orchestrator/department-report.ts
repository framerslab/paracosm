/**
 * One department's report for one event, as the turn loop asks for it: the
 * report schema for the keys the run holds, the retries, the salvage of a
 * reply whose one fault is effect keys the run does not hold, and the
 * fallback. What the call came to is recorded where the run records every
 * schema-validated call: the cost tracker's `schemaRetries` (a salvage in
 * the bucket's `salvaged`, a fallback in its `fallbacks`) and a
 * `validation_fallback` stream event, which for a salvage carries
 * `salvaged: true` and the keys it dropped.
 *
 * @module paracosm/runtime/orchestrator/department-report
 */
import { sendAndValidate, type SessionLike } from '../../llm/sendAndValidate.js';
import { departmentReportSchemaFor, salvageDepartmentReport, type DepartmentReportZ } from '../validators/department.js';
import { emptyReport } from '../util/parsers.js';

/** What a schema-validated call hands its `onValidationFallback`. */
export interface ValidationFallbackDetails {
  rawText: string;
  schemaName?: string;
  err: unknown;
}

/** The longest raw reply a `validation_fallback` event carries. */
const RAW_PREVIEW_CHARS = 1500;

/**
 * The data of the `validation_fallback` event for a call that returned its
 * fallback: where it ran, the schema, the start of the last reply, the
 * error (the stream schema requires it) and the first five schema issues.
 */
export function validationFallbackData(site: string, details: ValidationFallbackDetails): Record<string, unknown> {
  const zodIssues = (details.err as { validationErrors?: { issues?: Array<{ path?: unknown[]; message?: string; code?: string }> } } | undefined)?.validationErrors?.issues;
  return {
    site,
    schemaName: details.schemaName,
    rawTextPreview: details.rawText.slice(0, RAW_PREVIEW_CHARS),
    error: (details.err as { message?: string } | undefined)?.message ?? String(details.err),
    // Compact Zod issue list for the dashboard / forensic-replay tooling.
    issues: Array.isArray(zodIssues)
      ? zodIssues.slice(0, 5).map(i => ({ path: i.path ?? [], message: i.message, code: i.code }))
      : undefined,
  };
}

/** One department report call, with the run's recorders. */
export interface DepartmentReportCall {
  session: SessionLike;
  prompt: string;
  department: string;
  /** Where the call runs, as its events name it: `dept:<department>:turn<n>:event<n>`. */
  site: string;
  /** The keys the run holds as numbers (`effectKeys`), the only keys an effect may move. */
  heldKeys: readonly string[];
  /** The run's report schema for `heldKeys`, built once a run; built here when absent. */
  schema?: ReturnType<typeof departmentReportSchemaFor>;
  onUsage?: (r: { usage?: unknown }) => void;
  onProviderError?: (err: unknown) => void;
  /** The run's fallback reporter: it logs the call and emits its `validation_fallback` event. */
  onValidationFallback?: (details: ValidationFallbackDetails) => void;
  /** The cost tracker's `recordSchemaAttempt`. */
  recordSchemaAttempt: (schemaName: string, attempts: number, fellBack: boolean, salvaged?: boolean) => void;
  /** The run's event emitter; a salvage goes out on it as a `validation_fallback` event. */
  emit: (type: 'validation_fallback', data: Record<string, unknown>) => void;
  /** Where the call's own lines go (the run's stdout). */
  log?: (line: string) => void;
}

/** What one department report call came to. */
export interface DepartmentReportResult {
  report: DepartmentReportZ;
  fromFallback: boolean;
  /** True when the report was kept from a reply that named keys the run does not hold. */
  salvaged: boolean;
  attempts: number;
  /** The keys the kept report's effects named that the run does not hold, sorted; empty unless `salvaged`. */
  droppedKeys: string[];
  rawText: string;
}

/**
 * Ask a department for its report and record what the call came to. A
 * salvaged report counts in `schemaRetries.DepartmentReport.salvaged` and
 * goes out as a `validation_fallback` event with `salvaged: true` and the
 * dropped keys; a fallback counts in `fallbacks` and goes to
 * `onValidationFallback`, as it did.
 */
export async function sendDepartmentReport(call: DepartmentReportCall): Promise<DepartmentReportResult> {
  const { department, site } = call;
  const log = call.log ?? ((line: string) => console.log(line));
  const schemaName = 'DepartmentReport';
  let droppedKeys: string[] = [];
  const result = await sendAndValidate({
    session: call.session,
    prompt: call.prompt,
    schema: call.schema ?? departmentReportSchemaFor(call.heldKeys),
    schemaName,
    onUsage: call.onUsage,
    onProviderError: call.onProviderError,
    onValidationFallback: call.onValidationFallback,
    salvage: raw => salvageDepartmentReport(raw, call.heldKeys, (line, dropped) => {
      droppedKeys = dropped;
      log(`    [${department}] ${line}`);
    }),
    fallback: { ...emptyReport(department), summary: `${department} report unavailable this turn.` } as unknown as DepartmentReportZ,
  });
  call.recordSchemaAttempt(schemaName, result.attempts, result.fromFallback, result.salvaged);
  if (result.salvaged) {
    call.emit('validation_fallback', {
      site,
      schemaName,
      rawTextPreview: result.rawText.slice(0, RAW_PREVIEW_CHARS),
      error: `Validation failed after ${result.attempts} attempts; the report was kept without the effect keys the run does not hold`,
      salvaged: true,
      droppedKeys,
    });
  }
  if (result.fromFallback) {
    log(`    [${department}] schema fallback; using empty report skeleton`);
  }
  return {
    report: result.object,
    fromFallback: result.fromFallback,
    salvaged: result.salvaged,
    attempts: result.attempts,
    droppedKeys: result.salvaged ? droppedKeys : [],
    rawText: result.rawText,
  };
}
