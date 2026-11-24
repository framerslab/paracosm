import * as React from 'react';
import { useEffect } from 'react';
import { STORED_DATA } from '../layout/frameWords';
import styles from './StoredDataControls.module.scss';
void React;

/** Actions for the browser's data and, where allowed, server data. */
export interface StoredDataControlsProps {
  onClearLocal: () => void;
  onWipeServer?: () => void;
  onOpen?: () => void;
}

/** Gives the Settings tab the run actions available with an empty page. */
export function StoredDataControls({ onClearLocal, onWipeServer, onOpen }: StoredDataControlsProps) {
  useEffect(() => onOpen?.(), [onOpen]);
  return (
    <fieldset className={styles.group}>
      <legend>{STORED_DATA}</legend>
      <button type="button" onClick={onClearLocal}>Clear local data</button>
      {onWipeServer && <button type="button" onClick={onWipeServer}>Delete server data</button>}
    </fieldset>
  );
}
