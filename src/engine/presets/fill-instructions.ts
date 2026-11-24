import type { ActorConfig, ActorInput } from '../types.js';
import '../traits/builtins.js';
import { traitModelRegistry, withDefaults } from '../traits/index.js';
import { ACTOR_PRESETS } from './index.js';

export const MAX_ORDER_CHARS = 400;

/** Cut at a UTF-16 budget without leaving half of a surrogate pair. */
export function clipOrderText(text: string, budget = MAX_ORDER_CHARS): string {
  const end = Math.max(0, Math.trunc(budget));
  if (text.length <= end) return text;
  const before = text.charCodeAt(end - 1);
  const after = text.charCodeAt(end);
  const splitsPair = before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  return text.slice(0, splitsPair ? end - 1 : end);
}

function sentence(text: string, budget: number): string {
  const clipped = clipOrderText(text, budget).trimEnd();
  if (/[.!?]$/.test(clipped)) return clipped;
  const body = clipOrderText(clipped, budget - 1).trimEnd();
  return body ? body + '.' : '';
}

function traitCues(actor: ActorInput, modelId: string): string[] {
  const model = traitModelRegistry.get(modelId);
  if (!model) return [];
  const scores = withDefaults(actor.traitProfile?.traits ?? { ...actor.hexaco }, model);
  const cues: string[] = [];
  for (const { id } of model.axes) {
    const poles = model.cues[id];
    const cue = (scores[id] < 0.35 ? poles?.low : scores[id] > 0.65 ? poles?.high : undefined)?.trim();
    if (cue) cues.push(cue.charAt(0).toUpperCase() + cue.slice(1));
  }
  return cues;
}

/** Resolve blank orders while keeping authored text and the rest of the leader intact. */
export function fillInstructions(actor: ActorInput): ActorConfig {
  if (typeof actor.instructions === 'string' && actor.instructions.trim()) return actor as ActorConfig;

  const name = clipOrderText(actor.name?.trim() || 'Leader', 80).trimEnd();
  const archetype = actor.archetype?.trim() || 'Leader';
  const title = sentence(archetype, 61);
  const opening = `You are ${name}, "${title}"`;
  const modelId = actor.traitProfile?.modelId ?? 'hexaco';
  const closing = modelId === 'hexaco'
    ? 'Your HEXACO profile drives your leadership style.'
    : 'Your trait profile drives your leadership style.';
  const temperament = actor.description?.trim() || Object.values(ACTOR_PRESETS).find(
    preset => preset.archetype.trim().toLowerCase() === archetype.toLowerCase(),
  )?.description || '';
  const cues = traitCues(actor, modelId);

  // Each optional sentence takes its text plus the separating space.
  let available = MAX_ORDER_CHARS - opening.length - closing.length - 1;
  const first = cues[0] ?? '';
  const firstLength = first ? sentence(first, first.length + 1).length + 1 : 0;
  const descriptionFloor = temperament ? sentence(temperament, 40).length + 1 : 0;
  const firstReserve = Math.min(firstLength, available - descriptionFloor);
  const description = sentence(temperament, Math.min(140, available - firstReserve - 1));
  const parts = [opening];
  if (description) {
    parts.push(description);
    available -= description.length + 1;
  }
  for (const [index, cue] of cues.entries()) {
    const whole = sentence(cue, cue.length + 1);
    const part = index === 0 ? sentence(cue, available - 1) : whole;
    if (part && part.length + 1 <= available) {
      parts.push(part);
      available -= part.length + 1;
    }
  }
  parts.push(closing);
  return { ...actor, instructions: parts.join(' ') };
}
