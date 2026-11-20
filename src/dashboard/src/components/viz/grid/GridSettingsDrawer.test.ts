import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GRID_SETTINGS, storedGridSettings } from './GridSettingsDrawer';

test('storedGridSettings keeps the stored switches that exist and drops the removed ones', () => {
  const stored = { deptLabels: true, crosshair: false, alerts: false, sound: true, lines: true, dust: false, ghostTrail: true, deptRings: true, animSpeed: 2, __v: 3 };
  assert.deepEqual(storedGridSettings(stored), { deptLabels: true, crosshair: false, alerts: false, sound: true });
});

test('storedGridSettings falls back to the default for a value of the wrong type', () => {
  assert.deepEqual(storedGridSettings({ deptLabels: 'yes', crosshair: 0 }), DEFAULT_GRID_SETTINGS);
});
