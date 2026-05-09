/**
 * Window-level drag-and-drop for the dashboard shell. Attaches dragenter
 * / dragover / dragleave / drop listeners once at the app root and
 * exposes a boolean `isDragging` that drives a full-viewport overlay.
 *
 * On drop: file list is validated via {@link validateDropFiles}. A
 * valid `.json` is handed to the caller's `onFile` callback (typically
 * `useLoadPreview.openFromFile`); invalid payloads route to `onError`.
 *
 * Uses a drag counter (incremented on dragenter, decremented on
 * dragleave) rather than a plain boolean so the overlay doesn't
 * flicker when the cursor crosses child elements while dragging.
 *
 * @module paracosm/cli/dashboard/hooks/useDashboardDropZone
 */
import { useEffect, useRef, useState } from 'react';
import {
  hasFilesDragPayload,
  validateDropFiles,
} from './useDashboardDropZone.helpers';

export interface UseDashboardDropZoneOptions {
  /** Called with the first valid `.json` file from the drop. */
  onFile: (file: File) => void;
  /**
   * Called when the drop can't produce a valid file. `kind` matches
   * {@link DropFilesResult.kind} when relevant; `multiFileTotal` is
   * provided when the drop had >1 files and the first was valid
   * (informational case).
   */
  onError?: (kind: 'unsupported', detail?: { multiFileTotal?: number }) => void;
  /**
   * Called when the drop had a valid first file plus extra files the
   * caller may want to inform the user about. Separate from onError
   * because the first file IS loaded — this is advisory.
   */
  onMultipleFiles?: (totalCount: number) => void;
}

export interface UseDashboardDropZoneApi {
  /** `true` while a file drag is in progress over the viewport. */
  isDragging: boolean;
}

export function useDashboardDropZone(
  opts: UseDashboardDropZoneOptions,
): UseDashboardDropZoneApi {
  const [isDragging, setIsDragging] = useState(false);
  // Ref holds the latest opts so the event handlers never close over a
  // stale callback. Without this, swapping onFile between renders
  // would require re-subscribing the window listeners.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let counter = 0;

    /**
     * `true` when the drag event's target is inside an element that
     * declared its own local drop zone via the
     * `data-paracosm-local-dropzone` attribute. The Quickstart PDF tab
     * uses this so a PDF drop on its dashed-border zone is handled
     * locally (extracted via pdf.js, not rejected with "Only .json
     * simulation files supported"). The window listener short-circuits
     * for these events so it never preventDefault()'s and never fires
     * its onError toast.
     *
     * Hit-tests against the event target: if the closest ancestor
     * carrying the data attribute exists, the local zone wins.
     */
    const isInsideLocalDropZone = (e: DragEvent): boolean => {
      const target = e.target as Element | null;
      if (!target || typeof target.closest !== 'function') return false;
      return !!target.closest('[data-paracosm-local-dropzone]');
    };

    const onDragEnter = (e: DragEvent) => {
      if (!hasFilesDragPayload(e.dataTransfer)) return;
      if (isInsideLocalDropZone(e)) return;
      counter += 1;
      setIsDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      // preventDefault is REQUIRED on every dragover, or browsers
      // treat the page as non-droppable and never fire the drop event.
      if (!hasFilesDragPayload(e.dataTransfer)) return;
      if (isInsideLocalDropZone(e)) return;
      e.preventDefault();
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasFilesDragPayload(e.dataTransfer)) return;
      if (isInsideLocalDropZone(e)) return;
      counter = Math.max(0, counter - 1);
      if (counter === 0) setIsDragging(false);
    };

    const onDrop = (e: DragEvent) => {
      if (!hasFilesDragPayload(e.dataTransfer)) return;
      // Local drop zones own PDF / future-format drops on the components
      // that declare them. Yield without preventDefault so the local
      // listener handles the drop.
      if (isInsideLocalDropZone(e)) {
        counter = 0;
        setIsDragging(false);
        return;
      }
      e.preventDefault();
      counter = 0;
      setIsDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const outcome = validateDropFiles(files);
      const { onFile, onError, onMultipleFiles } = optsRef.current;
      switch (outcome.kind) {
        case 'ok':
          onFile(outcome.file);
          break;
        case 'ok-with-extras':
          onMultipleFiles?.(outcome.totalCount);
          onFile(outcome.file);
          break;
        case 'unsupported':
          onError?.('unsupported');
          break;
        case 'empty':
          // no-op
          break;
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return { isDragging };
}
