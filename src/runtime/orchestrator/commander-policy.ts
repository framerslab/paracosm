/**
 * The policy step of a turn: the commander's decision and the department
 * reports it read become a change to the kernel's state, as the
 * orchestrator runs it after each decision.
 *
 * @module paracosm/runtime/orchestrator/commander-policy
 */
import type { SimulationKernel } from '../../engine/core/kernel.js';
import type { EffectRegistry, TurnOutcome } from '../../engine/registries/effects.js';
import type { ScenarioHooks, ScenarioPackage } from '../../engine/types.js';
import type { CommanderDecision, DepartmentReport } from '../contracts.js';
import { decisionToPolicy, oneLine, reportPatchesAsked, resolveSelectedEffects, selectedEffectTotals } from '../util/parsers.js';

/** What one decision's policy step changed. */
export interface CommanderPolicyApplied {
  /** Each key the policy moved, with the change the kernel applied. */
  deltas: Record<string, number>;
  /** The selections that name no effect of the reports. */
  unmatched: string[];
  /** The selections whose key names more than one effect; none of them applied. */
  ambiguous: string[];
  /**
   * The keys whose change differs from what the selected effects asked:
   * the bound of one decision held it, a floor or ceiling stopped it, or
   * a morale gain eased above 0.9 (`moraleAfterGain`). Empty when every
   * key moved as asked.
   */
  limited: Record<string, { asked: number; applied: number }>;
  /**
   * The keys of the selected effects that the run holds in neither its
   * metrics nor its politics, sorted; the kernel dropped each, so they
   * moved nothing.
   */
  notHeld: string[];
}

/** The scenario's outcome tables, which bound what one decision's effects move. */
export interface PolicyEffectTables {
  /** The category tables (`EffectRegistry.forScenario`). */
  registry: EffectRegistry;
  /** The politics table (`hooks.politicsHook`), read for each category and outcome. */
  politicsHook?: ScenarioHooks['politicsHook'];
  /** Categories to read the politics table for besides the registry's own (a scenario's `knowledge.categoryMapping` keys). */
  categories?: Iterable<string>;
}

const OUTCOMES: TurnOutcome[] = ['risky_success', 'conservative_success', 'conservative_failure', 'risky_failure'];

/**
 * The outcome tables a run of `sc` bounds its decisions by, as the turn
 * loop builds them once for a run: the category tables of `registry`
 * (`EffectRegistry.forScenario(sc)`), the politics hook, and the
 * categories of the scenario's `knowledge.categoryMapping`, which the
 * politics table is also read for.
 *
 * A scenario that declares no politics keys (`world.politics` empty or
 * absent) has no politics table: at an outcome the kernel drops every key
 * the hook returns, since the run holds no politics, so its numbers could
 * act only by lifting a limit. The compiler refuses such a hook for the
 * categories it knows when it generates it (`generate-politics.ts`); this
 * also covers a category the seed's knowledge adds after the hooks are
 * generated and a hook restored from the hook cache, which is not checked
 * again.
 */
export function policyEffectTablesFor(sc: ScenarioPackage, registry: EffectRegistry): PolicyEffectTables {
  const declaresPolitics = Object.keys(sc.world?.politics ?? {}).length > 0;
  return {
    registry,
    politicsHook: declaresPolitics ? sc.hooks.politicsHook : undefined,
    categories: Object.keys(sc.knowledge?.categoryMapping ?? {}),
  };
}

/** The limits read for each tables object: a run passes one for all its decisions. */
const limitsByTables = new WeakMap<PolicyEffectTables, Readonly<Record<string, number>>>();

/**
 * The most one decision's adopted effects move each key the outcome
 * tables name: the largest absolute entry the key has in a category table
 * or in the politics table, which is what one event brings on that key at
 * an ordinary response; a key the tables name only with 0 has 0. Mars
 * Genesis: `infrastructureModules` 2, `foodMonthsReserve` 4, `morale`
 * 0.15, `earthDependencyPct` 3. The tables are read once for a tables
 * object (a compiled politics hook runs in a sandbox of its own at each
 * call), so the limits stay what they were when first read.
 */
export function policyEffectLimits(tables?: PolicyEffectTables): Readonly<Record<string, number>> {
  if (!tables) return {};
  const known = limitsByTables.get(tables);
  if (known) return known;
  const limits = tables.registry.largestEntries();
  limitsByTables.set(tables, limits);
  const hook = tables.politicsHook;
  if (!hook) return limits;
  for (const category of new Set([...tables.registry.categories(), ...(tables.categories ?? [])])) {
    for (const outcome of OUTCOMES) {
      let entry: unknown;
      try {
        entry = hook(category, outcome);
      } catch {
        // A compiled hook that throws names nothing for this category.
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      for (const [key, value] of Object.entries(entry)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        limits[key] = Math.max(limits[key] ?? 0, Math.abs(value));
      }
    }
  }
  return limits;
}

/**
 * How far one decision's adopted effects may move `key` from `current`:
 * its outcome tables' limit ({@link policyEffectLimits}), else a tenth of
 * its current absolute value, or 1 when it is 0. The kernel moves a head
 * count in whole people, rounding the change, so the bound on
 * `population` rounds down to whole people.
 */
export function policyEffectBound(key: string, current: number, limits: Readonly<Record<string, number>>): number {
  const limit = limits[key] ?? (current !== 0 ? Math.abs(current) / 10 : 1);
  return key === 'population' ? Math.floor(limit) : limit;
}

/**
 * Apply a commander's decision to the kernel. The selected effects move
 * each key at most what one event outcome brings on it, by the scenario's
 * outcome `tables` ({@link policyEffectBound}); with no tables, no key is
 * named, so each moves at most a tenth of its value. What moved is logged
 * as a `[policy] effects` line, with what the effects asked after it
 * (`asked: {...}`) when a key moved otherwise; the selections that name
 * no effect of the reports (a free policy name, a key the reports do not
 * hold) as a `[policy] no effect named by` line, and the keys of the
 * selected effects the run does not hold as a `[policy] effect keys not
 * held, dropped` line with the keys it holds, so none is dropped without a
 * trace. The run's own reports hold no such key: one that passed the run's
 * schema (`departmentReportSchemaFor`) names none, one that still named
 * one after its retries had it dropped (`salvageDepartmentReport`), and
 * the fallback (`emptyReport`) has no effects; a caller that validated its
 * reports with the plain schema may pass one. A report's `proposedPatches`
 * move nothing; each one that would write the state is logged as a
 * `[policy] department patches set nothing` line with what it asked.
 */
export function applyCommanderPolicy(
  kernel: SimulationKernel,
  decision: CommanderDecision,
  reports: DepartmentReport[],
  turn: number,
  time: number,
  log: (line: string) => void = console.log,
  tables?: PolicyEffectTables,
): CommanderPolicyApplied {
  const limits = policyEffectLimits(tables);
  const { metrics, politics } = kernel.getState();
  const current = (key: string): number => {
    const held = [(metrics as Record<string, unknown>)[key], (politics as Record<string, unknown>)[key]].find(v => typeof v === 'number');
    return typeof held === 'number' ? held : 0;
  };
  const deltas = kernel.applyPolicy(decisionToPolicy(decision, reports, turn, time, key => policyEffectBound(key, current(key), limits)));
  const totals = selectedEffectTotals(decision, reports);
  const asked = Object.fromEntries(Object.keys(deltas).map(k => [k, totals[k] ?? 0]));
  const limited: CommanderPolicyApplied['limited'] = {};
  for (const [key, applied] of Object.entries(deltas)) {
    if (applied !== asked[key]) limited[key] = { asked: asked[key], applied };
  }
  if (Object.keys(deltas).length > 0) {
    log(`  [policy] effects: ${JSON.stringify(deltas)}${Object.keys(limited).length > 0 ? ` asked: ${JSON.stringify(asked)}` : ''}`);
  }
  const { picked, unmatched, ambiguous } = resolveSelectedEffects(decision, reports);
  const state = kernel.getState();
  const held = new Set(
    Object.entries({ ...state.metrics, ...state.politics }).filter(([, v]) => typeof v === 'number').map(([k]) => k),
  );
  const notHeld = [...new Set(picked.flatMap(({ effect }) => [
    ...Object.keys(effect.systemDelta ?? {}),
    ...Object.keys(effect.politicsDelta ?? {}),
  ]))].filter(k => !held.has(k)).sort();
  const patches = reportPatchesAsked(reports);
  if (patches.length > 0) {
    log(`  [policy] department patches set nothing (only selected effects move the state): ${patches.map(p => `${oneLine(p.department)} asked ${JSON.stringify(p.asked)}`).join('; ')}`);
  }
  if (notHeld.length > 0) log(`  [policy] effect keys not held, dropped: ${notHeld.join(', ')} (the run holds ${[...held].join(', ')})`);
  if (unmatched.length > 0) log(`  [policy] no effect named by: ${unmatched.map(u => JSON.stringify(u)).join(', ')}`);
  if (ambiguous.length > 0) log(`  [policy] more than one effect named by, none applied: ${ambiguous.map(u => JSON.stringify(u)).join(', ')}`);
  return { deltas, unmatched, ambiguous, limited, notHeld };
}
