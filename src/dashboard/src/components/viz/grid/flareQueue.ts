export type FlareKind =
  | 'birth'
  | 'death'
  | 'forge_approved'
  | 'forge_rejected'
  | 'reuse'
  | 'crisis';

/** Hard cap on active flares — oldest evicted past this count. */
export const MAX_ACTIVE_FLARES = 30;

export interface FlareInput {
  kind: FlareKind;
  x: number;
  y: number;
  /** Frames until this flare's effect fully decays. */
  totalFrames: number;
  /** Optional: radial extent for flares that spread. */
  radius?: number;
  /** Optional: secondary endpoint for reuse arcs. */
  endX?: number;
  endY?: number;
  /** Optional: related sim entity for hover lookup + remap. */
  sourceId?: string;
}

export interface ActiveFlare extends FlareInput {
  age: number;
  /** age / totalFrames in [0, 1). */
  progress: number;
}

export interface FlareQueue {
  items: ActiveFlare[];
}

export function createFlareQueue(): FlareQueue {
  return { items: [] };
}

/**
 * Push a flare onto the queue. When at capacity, evict the oldest
 * (head of array) so newest always land.
 */
export function pushFlare(q: FlareQueue, input: FlareInput): void {
  q.items.push({ ...input, age: 0, progress: 0 });
  while (q.items.length > MAX_ACTIVE_FLARES) q.items.shift();
}

/**
 * Advance every flare's age by 1. Expires flares whose age reaches
 * their totalFrames. Caller invokes once per rendered frame.
 */
export function tickFlares(q: FlareQueue): void {
  const next: ActiveFlare[] = [];
  for (const f of q.items) {
    const age = f.age + 1;
    if (age >= f.totalFrames) continue;
    next.push({ ...f, age, progress: age / f.totalFrames });
  }
  q.items = next;
}

export function activeFlares(q: FlareQueue): ActiveFlare[] {
  return q.items;
}
