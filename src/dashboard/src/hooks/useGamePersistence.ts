import { useCallback } from 'react';
import type { SimEvent } from './useSSE';
import { migrateLegacyEventShape } from './migrateLegacyEventShape';
import {
  CURRENT_SCHEMA_VERSION,
  runMigrationChain,
  SchemaVersionTooNewError,
} from './schemaMigration';


function storageKey(scenarioShortName: string, key: string) {
  return `${scenarioShortName}-${key}`;
}

/**
 * Scenario identity stamp written into saved files so consumers can
 * detect mismatch between the file's origin and the dashboard's active
 * scenario. Added as part of F9's save shape; older files lack this
 * field and fall through to heuristic inference in the load preview.
 */
export interface SavedScenarioStamp {
  id: string;
  version: string;
  shortName: string;
}

/**
 * Result of a parseFile call. Successful parse carries the migrated
 * data plus metadata about whether migration was needed; failures carry
 * a narrow reason the UI can branch on.
 */
export type ParseResult =
  | {
      ok: true;
      data: GameData;
      /** Version the file declared (or 1 when absent). */
      fromVersion: number;
      /** True when the migration chain applied at least one step. */
      migrated: boolean;
    }
  | { ok: false; reason: 'empty' | 'parse-failed' }
  | {
      ok: false;
      reason: 'too-new';
      /** Version declared in the file that we can't handle. */
      fileVersion: number;
      /** Highest version this dashboard build supports. */
      dashboardVersion: number;
    };

interface GameData {
  config: Record<string, unknown> | null;
  events: SimEvent[];
  results: unknown[];
  /** End-of-sim LLM verdict — was being silently dropped from saves before. */
  verdict?: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
  /** Schema version so future loads can migrate older payloads. */
  schemaVersion?: number;
  /** Scenario this run was recorded under. Added in F9; older saves omit it. */
  scenario?: SavedScenarioStamp;
}

export function useGamePersistence(
  scenarioShortName: string,
  scenarioStamp?: SavedScenarioStamp,
) {
  const save = useCallback((events: SimEvent[], results: unknown[], verdict?: Record<string, unknown> | null) => {
    const data: GameData = {
      config: null,
      events,
      results,
      verdict: verdict ?? null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      // Shared with parseFile's migration chain so bumping the version
      // here and in schemaMigration.ts stays a single edit.
      schemaVersion: CURRENT_SCHEMA_VERSION,
      ...(scenarioStamp ? { scenario: scenarioStamp } : {}),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${scenarioShortName}-${events.length}events.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [scenarioShortName, scenarioStamp]);

  /**
   * Open the native file picker and resolve to the picked File, or
   * `null` if the user cancelled. Exposed separately from `parseFile`
   * so the two-stage preview flow can insert a modal between pick and
   * apply.
   *
   * Cancel detection: `input.onchange` only fires when a file is
   * selected. A user who cancels the picker dialog never triggers
   * onchange, which would hang the returned promise. We listen for
   * window `focus` (fired when the OS dialog closes and control
   * returns to the page) with a small delay so a real selection can
   * still win the race, then resolve with `null`.
   */
  const pickFile = useCallback((): Promise<File | null> => {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      let settled = false;
      const settle = (file: File | null) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onFocus);
        resolve(file);
      };
      const onFocus = () => {
        // 300ms lets onchange fire first when a file was actually
        // picked; if nothing selected by then, treat as cancel.
        window.setTimeout(() => settle(null), 300);
      };
      input.onchange = () => {
        settle(input.files?.[0] ?? null);
      };
      window.addEventListener('focus', onFocus, { once: true });
      input.click();
    });
  }, []);

  /**
   * Parse a picked File into a migration-complete {@link GameData} +
   * version metadata. The {@link runMigrationChain} chain lifts older
   * shapes up to {@link CURRENT_SCHEMA_VERSION}; forward-incompatible
   * files return `{ ok: false, reason: 'too-new' }` so the UI can
   * surface a block-load state instead of silently dropping fields.
   */
  const parseFile = useCallback((file: File): Promise<ParseResult> => {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const raw = JSON.parse(reader.result as string) as Record<string, unknown>;
          if (!Array.isArray(raw.events) || (raw.events as unknown[]).length === 0) {
            resolve({ ok: false, reason: 'empty' });
            return;
          }
          const fromVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
          try {
            const migrated = runMigrationChain(raw as never);
            // Structural cast: migrated satisfies the readable subset of
            // GameData (events/results/verdict/startedAt). `config` on
            // GameData is a save-time-only field that loaders never need.
            resolve({
              ok: true,
              data: migrated as unknown as GameData,
              fromVersion,
              migrated: fromVersion < CURRENT_SCHEMA_VERSION,
            });
          } catch (err) {
            if (err instanceof SchemaVersionTooNewError) {
              resolve({
                ok: false,
                reason: 'too-new',
                fileVersion: err.fileVersion,
                dashboardVersion: err.dashboardVersion,
              });
              return;
            }
            resolve({ ok: false, reason: 'parse-failed' });
          }
        } catch {
          resolve({ ok: false, reason: 'parse-failed' });
        }
      };
      reader.onerror = () => resolve({ ok: false, reason: 'parse-failed' });
      reader.readAsText(file);
    });
  }, []);

  /**
   * Back-compat composed load: pick + parse. Retained so pre-F9 callers
   * that want the fire-and-forget shape keep working. Collapses any
   * non-ok parse result to `null` since legacy callers can't surface
   * the richer failure reasons.
   */
  const load = useCallback(async (): Promise<GameData | null> => {
    const file = await pickFile();
    if (!file) return null;
    const result = await parseFile(file);
    return result.ok ? result.data : null;
  }, [pickFile, parseFile]);

  const cacheEvents = useCallback((events: SimEvent[], results: unknown[]) => {
    try {
      localStorage.setItem(storageKey(scenarioShortName, 'game-data'), JSON.stringify({
        events, results, startedAt: new Date().toISOString(),
      }));
    } catch {}
  }, [scenarioShortName]);

  const restoreFromCache = useCallback((): GameData | null => {
    try {
      if (localStorage.getItem(storageKey(scenarioShortName, 'cleared'))) return null;
      const cached = localStorage.getItem(storageKey(scenarioShortName, 'game-data'));
      if (!cached) return null;
      const data = JSON.parse(cached);
      if (!data.events?.length) return null;
      // Same legacy-shape migration as load() so browser caches
      // written by pre-0.5.0 builds render correctly after upgrade.
      const migrated = migrateLegacyEventShape(data.events, data.results);
      return {
        ...data,
        events: migrated.events as SimEvent[],
        results: migrated.results ?? data.results ?? [],
      };
    } catch {
      return null;
    }
  }, [scenarioShortName]);

  const clearCache = useCallback(() => {
    localStorage.removeItem(storageKey(scenarioShortName, 'game-data'));
    localStorage.setItem(storageKey(scenarioShortName, 'cleared'), Date.now().toString());
    fetch('/clear', { method: 'POST' }).catch(() => {});
  }, [scenarioShortName]);

  return { save, load, pickFile, parseFile, cacheEvents, restoreFromCache, clearCache };
}
