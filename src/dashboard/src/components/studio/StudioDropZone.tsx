/**
 * Drag-drop + click-to-upload zone for Studio. Reads the dropped file
 * as text, hands the text to the supplied parser, and forwards the
 * StudioInput result via onLoaded. Size-guards at 10 MB before reading
 * to avoid OOMing on a misclicked 1 GB JSON.
 *
 * @module paracosm/dashboard/studio/StudioDropZone
 */
import * as React from 'react';
import styles from './StudioTab.module.scss';
import { parseStudioInput, type StudioInput } from './parseStudioInput.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface StudioDropZoneProps {
  onLoaded: (input: StudioInput, filename: string) => void;
}

export function StudioDropZone({ onLoaded }: StudioDropZoneProps): JSX.Element {
  const [dragActive, setDragActive] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; hint?: string } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = React.useCallback(async (file: File) => {
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError({ message: `File is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)`, hint: `Got ${Math.round(file.size / 1024 / 1024)} MB` });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      // file.text() can reject if the underlying File handle is
      // revoked mid-read (rare on local drag-drop, common on iOS
      // when an OS picker hands back a stale reference).
      setError({
        message: 'Failed to read file',
        hint: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const result = parseStudioInput(text);
    if (result.kind === 'error') {
      setError({ message: result.message, hint: result.hint });
      return;
    }
    onLoaded(result, file.name);
  }, [onLoaded]);

  const onDrop = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  const onDragOver = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const onDragLeave = React.useCallback(() => setDragActive(false), []);

  const onClick = React.useCallback(() => inputRef.current?.click(), []);

  const onFilePicked = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // Reset so picking the same file twice triggers onChange again.
    e.target.value = '';
  }, [handleFile]);

  const className = [
    styles.dropZone,
    dragActive ? styles.dropZoneActive : '',
    error ? styles.dropZoneError : '',
  ].filter(Boolean).join(' ');

  return (
    <div>
      <div
        className={className}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
      >
        <div>Drop a paracosm RunArtifact JSON here, or click to browse</div>
        <div className={styles.dropZoneHint}>Single artifact or bundle (array of artifacts), max 10 MB</div>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className={styles.fileInput}
          onChange={onFilePicked}
        />
      </div>
      {error && (
        <div className={styles.errorBanner} role="alert">
          <div>{error.message}</div>
          {error.hint && <div className={styles.errorHint}>{error.hint}</div>}
        </div>
      )}
    </div>
  );
}
