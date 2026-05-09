/**
 * Pure helpers that render the Quickstart form state as a TypeScript SDK
 * recipe and a curl recipe. Used by ViewAsCodePanel; no React, no DOM,
 * no I/O — fully unit-testable.
 *
 * @module paracosm/dashboard/quickstart/view-as-code
 */

/** Subset of Quickstart input state that the recipes mirror. */
export interface RecipeInput {
  seedText: string;
  domainHint?: string;
  sourceUrl?: string;
  /** Number of HEXACO leaders the run will generate. Default 3 — when
   *  the form value equals the default, the recipes omit it so the
   *  output stays short for the common case. */
  actorCount: number;
}

/**
 * Render the form state as a TypeScript recipe using the v0.9
 * `runMany` top-level shortcut. Single import, the prompt is the
 * first arg (string brief or URL instance for sourceUrl-driven runs).
 */
export function renderTsRecipe(state: RecipeInput): string {
  const seed = escapeForTsTemplate(state.seedText.length > 0 ? state.seedText : '<paste your scenario above>');
  const lines: string[] = [];
  lines.push("// Recreate this Quickstart run from your code.");
  lines.push("import { runMany } from 'paracosm';");
  lines.push('');
  if (state.sourceUrl && state.sourceUrl.length > 0) {
    lines.push('const { runs } = await runMany(');
    lines.push(`  new URL('${escapeForTsSingleQuote(state.sourceUrl)}'),`);
    lines.push(`  { count: ${state.actorCount} },`);
    lines.push(');');
  } else {
    lines.push('const { runs } = await runMany(');
    lines.push(`  \`${seed}\`,`);
    lines.push(`  { count: ${state.actorCount} },`);
    lines.push(');');
  }
  lines.push('');
  lines.push('runs.forEach(({ actor, artifact }) => console.log(actor.name, artifact.fingerprint));');
  return lines.join('\n');
}

/**
 * Escape arbitrary user text for embedding inside a TypeScript template
 * literal (backtick-delimited). Order matters: backslash MUST be replaced
 * first so subsequent replacements do not double-escape it. Newlines pass
 * through verbatim — template literals support them natively.
 */
function escapeForTsTemplate(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

/**
 * Escape user text for embedding inside a single-quoted TypeScript string.
 * Backslash first (same reason as `escapeForTsTemplate`), then literal
 * single quote.
 */
function escapeForTsSingleQuote(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Render the form state as a curl recipe targeting the dashboard's
 * `compile-from-seed` HTTP endpoint. The curl recipe stops at compile
 * because the HTTP surface does not auto-generate HEXACO leaders; the
 * inline comment points users at the TypeScript variant for the full
 * flow.
 */
export function renderCurlRecipe(state: RecipeInput): string {
  const body: Record<string, string | number> = {
    seedText: state.seedText.length > 0 ? state.seedText : '<paste your scenario above>',
  };
  if (state.domainHint && state.domainHint.trim().length > 0) {
    body.domainHint = state.domainHint;
  }
  // Only emit actorCount in the curl body when the user moved off the
  // dashboard default. 2 is the slider's starting point; 3+ runs are
  // first-class on every surface, so the field is optional.
  if (state.actorCount !== 2) {
    body.actorCount = state.actorCount;
  }
  // sourceUrl is intentionally omitted from the curl body — the
  // compile-from-seed endpoint accepts it via a different field name
  // (`seedUrl`); rather than translate, the curl recipe scopes itself
  // to the seedText path and points users at the TS variant for the
  // URL-fetch flow.
  const json = JSON.stringify(body);
  // Wrap the JSON body in single quotes for the shell. The only edge
  // case is a literal `'` inside the JSON — handled by the standard
  // sh-quote idiom: replace every `'` with `'\''`.
  const shellQuoted = `'${json.replace(/'/g, "'\\''")}'`;

  const lines: string[] = [];
  lines.push('# This compiles a typed ScenarioPackage from your prompt.');
  lines.push('# For the full flow (auto-generate HEXACO leaders + simulate),');
  lines.push('# install paracosm and use the TypeScript tab.');
  lines.push('curl -X POST https://paracosm.agentos.sh/api/quickstart/compile-from-seed \\');
  lines.push("  -H 'Content-Type: application/json' \\");
  lines.push(`  -d ${shellQuoted}`);
  return lines.join('\n');
}
