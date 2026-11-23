/**
 * Where the people's names stand over the living grid's field
 * (placeNameLabels): every placed name whole inside the field, no two
 * touching, and a name left out only when the field has no room for it.
 *
 * The inputs are the hard cases the Run tab's shared panel meets: several
 * people of one department drawn in one small cluster on a phone's field,
 * every person on one point, a name wider than the field, and more names
 * than the field holds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nearestPointOnLabel,
  placeNameLabels,
  type NameLabelInput,
} from '../../../src/dashboard/src/components/viz/grid/nameLabelLayout.js';

interface Box { left: number; top: number; w: number; h: number }

const boxesOf = (items: NameLabelInput[], places: Map<string, { left: number; top: number }>): Box[] =>
  items.filter((item) => places.has(item.id)).map((item) => ({ ...places.get(item.id)!, w: item.w, h: item.h }));

const overlap = (a: Box, b: Box): boolean =>
  a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h;

function assertApartAndInside(boxes: Box[], bounds: { w: number; h: number }): void {
  for (const box of boxes) {
    assert.ok(box.left >= 0 && box.top >= 0, `a name starts inside the field: ${JSON.stringify(box)}`);
    assert.ok(box.left + box.w <= bounds.w && box.top + box.h <= bounds.h, `a name ends inside the field: ${JSON.stringify(box)}`);
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.equal(overlap(boxes[i], boxes[j]), false, `names ${i} and ${j} overlap: ${JSON.stringify([boxes[i], boxes[j]])}`);
    }
  }
}

const PHONE = { w: 286, h: 168 };

test('five people in four clusters on a phone: every name placed, inside the field, none touching', () => {
  // Rings as the grid clusters four departments round the field's middle, two people in one cluster.
  const items: NameLabelInput[] = [
    { id: 'a', x: 143, y: 40, w: 118, h: 24 },
    { id: 'b', x: 200, y: 80, w: 104, h: 24 },
    { id: 'c', x: 143, y: 132, w: 86, h: 24 },
    { id: 'd', x: 92, y: 88, w: 112, h: 24 },
    { id: 'e', x: 190, y: 92, w: 128, h: 24 },
  ];
  const rings = items.map((item) => ({ x: item.x, y: item.y, r: 12 }));
  const places = placeNameLabels(items, PHONE, rings);
  assert.equal(places.size, items.length);
  assertApartAndInside(boxesOf(items, places), PHONE);
  // The same input gives the same places.
  assert.deepEqual([...placeNameLabels(items, PHONE, rings)], [...places]);
});

test('every person on one point: every name still placed and none touching', () => {
  const items: NameLabelInput[] = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, x: 143, y: 84, w: 110, h: 24 }));
  const places = placeNameLabels(items, PHONE, items.map((item) => ({ x: item.x, y: item.y, r: 12 })));
  assert.equal(places.size, items.length);
  assertApartAndInside(boxesOf(items, places), PHONE);
});

test('a name stands beside its ring, away from the field\'s middle, when nothing is in the way', () => {
  const wide = { w: 1198, h: 278 };
  const right = placeNameLabels([{ id: 'r', x: 700, y: 140, w: 120, h: 24 }], wide).get('r');
  const left = placeNameLabels([{ id: 'l', x: 500, y: 140, w: 120, h: 24 }], wide).get('l');
  assert.ok(right && left);
  assert.ok(right.left > 700, 'right of the middle, the name starts after the ring');
  assert.ok(left.left + 120 < 500, 'left of the middle, the name ends before the ring');
  assert.equal(right.top, 140 - 12);
  assert.equal(left.top, 140 - 12);
  const joined = nearestPointOnLabel(right, { w: 120, h: 24 }, { x: 700, y: 140 });
  assert.equal(joined.y, 140);
  assert.ok(joined.distance > 0 && joined.distance < 20);
});

test('a name wider than the field starts at its edge; a field of no size places nothing', () => {
  const places = placeNameLabels([{ id: 'long', x: 100, y: 80, w: 900, h: 24 }], PHONE);
  const place = places.get('long');
  assert.ok(place);
  assert.equal(place.left, 2);
  assert.ok(place.top >= 2 && place.top + 24 <= PHONE.h);
  assert.equal(placeNameLabels([{ id: 'a', x: 1, y: 1, w: 50, h: 24 }], { w: 0, h: 0 }).size, 0);
});

test('more names than the field holds: the placed ones do not touch, and the rest are left out', () => {
  const items: NameLabelInput[] = Array.from({ length: 40 }, (_, i) => ({
    id: `p${i}`,
    x: 60 + (i % 8) * 24,
    y: 30 + Math.floor(i / 8) * 26,
    w: 130,
    h: 24,
  }));
  const places = placeNameLabels(items, PHONE);
  assert.ok(places.size >= 6, `${places.size} names placed`);
  assert.ok(places.size < items.length, 'a field this small cannot hold forty names');
  assertApartAndInside(boxesOf(items, places), PHONE);
  // An earlier name keeps its place whatever follows it.
  const firstAlone = placeNameLabels(items.slice(0, 1), PHONE).get('p0');
  assert.deepEqual(places.get('p0'), firstAlone);
});
