/**
 * ECOLOGY's quadrant map on a run that holds only some of its four readings.
 * The Deep Ocean Station (scenarios/submarine.json) declares a food store and
 * power and neither water nor pressurized volume, so its runs carry two of
 * the four. A quadrant with no reading stays clear: an absent reading is not
 * an abundant one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawEcologyResourceMap } from './ModeOverlayLayer';
import type { TurnSnapshot } from '../viz-types';

interface DeclaredMetric {
  initial: number;
}

const station = JSON.parse(
  readFileSync(new URL('../../../../../../scenarios/submarine.json', import.meta.url), 'utf-8'),
) as { world: { metrics: Record<string, DeclaredMetric | undefined> } };
const declared = station.world.metrics;

/** A canvas context that records each rectangle it fills and each line of text it draws. */
function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  texts: string[];
} {
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  const texts: string[] = [];
  const ctx = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    save(): void {},
    restore(): void {},
    fillRect(x: number, y: number, w: number, h: number): void {
      rects.push({ x, y, w, h });
    },
    fillText(text: string): void {
      texts.push(text);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, texts };
}

test('ECOLOGY tints only the quadrants whose reading the run holds', () => {
  // The scenario's own declaration: food and power, no water, no volume.
  assert.equal(typeof declared.foodMonthsReserve?.initial, 'number');
  assert.equal(typeof declared.powerKw?.initial, 'number');
  assert.equal(declared.waterLitersPerDay, undefined);
  assert.equal(declared.pressurizedVolumeM3, undefined);

  const snapshot: TurnSnapshot = {
    turn: 1,
    time: 1,
    cells: [],
    population: 50,
    morale: 0.75,
    foodReserve: declared.foodMonthsReserve?.initial,
    powerKw: declared.powerKw?.initial,
    deaths: 0,
    births: 0,
  };
  const { ctx, rects, texts } = recordingContext();
  drawEcologyResourceMap(ctx, snapshot, 400, 200);

  // Food is the top-left quadrant and power the bottom-left. Water (top
  // right) and pressurized volume (bottom right) have no reading.
  assert.deepEqual(rects, [
    { x: 0, y: 0, w: 200, h: 100 },
    { x: 0, y: 100, w: 200, h: 100 },
  ]);
  assert.deepEqual(texts, ['FOOD 8.0mo', 'POWER 200kW']);
});
