/**
 * Two-stage file-load flow: pick → parse → show metadata preview →
 * confirm OR cancel → apply (or drop) the parsed data.
 *
 * The hook is pure React wiring over the pure pieces in
 * useLoadPreview.helpers.ts. State transitions go through the reducer
 * there, metadata extraction through extractPreviewMetadata. The hook's
 * only job is to bridge FileReader + the reducer + the caller's
 * dispatch callback.
 *
 * @module paracosm/cli/dashboard/hooks/useLoadPreview
 */
import { useCallback, useReducer } from 'react';
import {
  extractPreviewMetadata,
  reducePreviewState,
  type CurrentScenarioContext,
  type PreviewMetadata,
  type PreviewState,
} from './useLoadPreview.helpers.js';
import type { SimEvent } from './useSSE';
import type { ParseResult } from './useGamePersistence';

export interface UseLoadPreviewOptions {
  /** Native file picker — typically `persistence.pickFile`. */
  pickFile: () => Promise<File | null>;
  /** Parser + migration hop — typically `persistence.parseFile`. */
  parseFile: (file: File) => Promise<ParseResult>;
  /**
   * Dashboard's active scenario used to detect mismatch with the loaded
   * file's scenario. Optional: omit to skip the match check entirely.
   */
  currentScenario?: CurrentScenarioContext;
  /**
   * Called on confirm. Receives the parsed + migrated save-file payload.
   * Host does whatever it needs (dispatch to SSE, switch tabs, toast).
   */
  onConfirm: (data: {
    events: SimEvent[];
    results: unknown[];
    verdict: Record<string, unknown> | null;
  }) => void;
  /** Called when a pick fails (non-JSON, empty events, parse error, too-new schema). */
  onError?: (reason: string) => void;
}

export interface UseLoadPreviewApi {
  state: PreviewState;
  /**
   * Returns a metadata-only snapshot of the current preview, or `null`
   * outside the `preview` state. Convenience accessor for the modal.
   */
  metadata: PreviewMetadata | null;
  /** Open the hidden file picker + walk the selected file through parse + preview. */
  openPicker: () => void;
  /**
   * Parse a pre-selected File (e.g. from drag-and-drop) and present the
   * preview. Skips the file picker; every other step of the flow is
   * identical to {@link openPicker}.
   */
  openFromFile: (file: File) => Promise<void>;
  /** Commit the preview — invokes onConfirm with the parsed data. */
  confirm: () => void;
  /** Drop the preview without dispatching. */
  cancel: () => void;
}

const initialState: PreviewState = { kind: 'idle' };

export function useLoadPreview(opts: UseLoadPreviewOptions): UseLoadPreviewApi {
  const [state, dispatch] = useReducer(reducePreviewState, initialState);

  const openFromFile = useCallback(async (file: File) => {
    dispatch({ type: 'open-started' });
    try {
      const parsed = await opts.parseFile(file);
      if (!parsed.ok) {
        dispatch({ type: 'open-failed' });
        if (parsed.reason === 'too-new') {
          opts.onError?.(
            `This file was saved under schema v${parsed.fileVersion}; ` +
              `this dashboard supports up to v${parsed.dashboardVersion}. ` +
              `Update the dashboard to load it.`,
          );
        } else {
          opts.onError?.('No valid game data found in file.');
        }
        return;
      }
      const metadata = extractPreviewMetadata(
        parsed.data,
        { name: file.name, size: file.size },
        opts.currentScenario,
      );
      if (!metadata) {
        dispatch({ type: 'open-failed' });
        opts.onError?.('No valid game data found in file.');
        return;
      }
      dispatch({ type: 'open-succeeded', metadata, data: parsed.data });
    } catch {
      dispatch({ type: 'open-failed' });
      opts.onError?.('Failed to read file.');
    }
  }, [opts]);

  const openPicker = useCallback(async () => {
    const file = await opts.pickFile();
    if (!file) return;
    await openFromFile(file);
  }, [opts, openFromFile]);

  const confirm = useCallback(() => {
    if (state.kind !== 'preview') return;
    const data = state.data as {
      events?: SimEvent[];
      results?: unknown[];
      verdict?: Record<string, unknown> | null;
    };
    dispatch({ type: 'confirm' });
    try {
      opts.onConfirm({
        events: (data.events ?? []) as SimEvent[],
        results: (data.results ?? []) as unknown[],
        verdict: (data.verdict ?? null) as Record<string, unknown> | null,
      });
    } finally {
      // Always close the modal, even if the caller's onConfirm throws.
      // Without finally, a throw would leave state stuck in 'dispatching'
      // and the modal unreachable until a full page reload.
      dispatch({ type: 'confirm-complete' });
    }
  }, [state, opts]);

  const cancel = useCallback(() => {
    dispatch({ type: 'cancel' });
  }, []);

  const metadata = state.kind === 'preview' ? state.metadata : null;

  return { state, metadata, openPicker, openFromFile, confirm, cancel };
}
