/**
 * Mulberry32: fast 32-bit seeded PRNG.
 * Deterministic: same seed always produces same sequence.
 */
export class SeededRng {
  private _state: number;

  constructor(seed: number) {
    this._state = seed | 0;
  }

  /** Current PRNG state, as a 32-bit integer. Captured into snapshots
   *  and restored via `fromState` for deterministic resume. */
  getState(): number {
    return this._state;
  }

  /** Construct a SeededRng positioned at a specific internal state.
   *  Different from the seed-based constructor: the returned RNG
   *  produces the same sequence as the source did AT THE MOMENT
   *  getState() was captured. */
  static fromState(state: number): SeededRng {
    const rng = new SeededRng(0);
    rng._state = state | 0;
    return rng;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this._state = (this._state + 0x6d2b79f5) | 0;
    let t = Math.imul(this._state ^ (this._state >>> 15), 1 | this._state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Returns true with the given probability (0-1). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Picks a random element from an array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /**
   * A stream of its own for one draw: one person, one cause, one turn.
   * The state is the FNV-1a 32-bit hash of `turn:agentId:cause` XOR the
   * run's seed, so two runs with the same seed roll the same dice for the
   * same person whatever else happened in them, and no other person's
   * draw moves it.
   */
  static forDraw(seed: number, turn: number, agentId: string, cause: string): SeededRng {
    const key = `${turn}:${agentId}:${cause}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return new SeededRng((hash ^ seed) | 0);
  }

  /**
   * The one die a person keeps for a cause of death for their whole life,
   * in a run whose scenario keeps one death die for a life
   * (`setup.mortalityDice: 'life'`): keyed by the seed, the person and the
   * cause, and by no turn or year.
   */
  static forLife(seed: number, agentId: string, cause: string): SeededRng {
    return SeededRng.forDraw(seed, 0, agentId, `life:${cause}`);
  }

  /** Derives a child RNG for a specific turn (deterministic sub-stream). */
  turnSeed(turn: number): SeededRng {
    return new SeededRng(this._state ^ (turn * 2654435761));
  }
}
