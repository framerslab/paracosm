import { useEffect, useRef } from 'react';
import type { TurnSnapshot } from '../viz-types.js';

type ForgeAttemptLike = { turn: number; eventIndex: number; department: string; name: string; approved: boolean };

interface UseSoundCuesInputs {
  enabled: boolean;
  snapshotA: TurnSnapshot | undefined;
  prevSnapshotA: TurnSnapshot | undefined;
  snapshotB: TurnSnapshot | undefined;
  prevSnapshotB: TurnSnapshot | undefined;
  forgeAttemptsA: ForgeAttemptLike[];
  forgeAttemptsB: ForgeAttemptLike[];
}

/** Simple Web-Audio generative tones. Avoids any asset bundling — just
 *  oscillators + envelopes. Gain tuned low so the cues read as chimes,
 *  not alarms. */
function playTone(ctx: AudioContext, freq: number, dur: number, peak = 0.04, wave: OscillatorType = 'sine'): void {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

function playCue(ctx: AudioContext, kind: 'birth' | 'death' | 'forge' | 'crisis'): void {
  switch (kind) {
    case 'birth':
      playTone(ctx, 880, 0.18, 0.05, 'triangle');
      setTimeout(() => playTone(ctx, 1320, 0.12, 0.03, 'triangle'), 70);
      break;
    case 'death':
      playTone(ctx, 160, 0.35, 0.05, 'sine');
      break;
    case 'forge':
      playTone(ctx, 660, 0.12, 0.04, 'sine');
      break;
    case 'crisis':
      playTone(ctx, 220, 0.22, 0.05, 'sawtooth');
      setTimeout(() => playTone(ctx, 180, 0.18, 0.045, 'sawtooth'), 120);
      break;
  }
}

/**
 * Side-effect hook that plays audio cues on new events without owning
 * UI. Lazily constructs an AudioContext on first cue + persists it.
 * Respects the `enabled` flag; seen-keys dedup so replays don't
 * re-fire on re-renders.
 */
export function useSoundCues(inputs: UseSoundCuesInputs): void {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const lastTurnA = useRef<number>(-1);
  const lastTurnB = useRef<number>(-1);

  const ensureCtx = (): AudioContext | null => {
    if (!inputs.enabled) return null;
    if (audioCtxRef.current) return audioCtxRef.current;
    try {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioCtxRef.current = new Ctor();
      return audioCtxRef.current;
    } catch {
      return null;
    }
  };

  // Resume the AudioContext on first user interaction (browsers
  // require a gesture to unlock audio).
  useEffect(() => {
    if (!inputs.enabled) return;
    const unlock = () => {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => { /* silent */ });
    };
    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [inputs.enabled]);

  // Births + deaths via snapshot diff.
  useEffect(() => {
    if (!inputs.enabled) return;
    const fireFor = (
      snap: TurnSnapshot | undefined,
      prev: TurnSnapshot | undefined,
      side: 'a' | 'b',
      lastTurnRef: React.MutableRefObject<number>,
    ) => {
      if (!snap || !prev) return;
      if (snap.turn === lastTurnRef.current) return;
      lastTurnRef.current = snap.turn;
      const ctx = ensureCtx();
      if (!ctx) return;
      const prevIds = new Set(prev.cells.map(c => c.agentId));
      const currIds = new Set(snap.cells.map(c => c.agentId));
      let births = 0;
      let deaths = 0;
      for (const c of snap.cells) {
        if (!prevIds.has(c.agentId) && c.alive) {
          const key = `${side}|t${snap.turn}|birth|${c.agentId}`;
          if (!seenRef.current.has(key)) {
            seenRef.current.add(key);
            births += 1;
          }
        }
      }
      for (const prevCell of prev.cells) {
        const curr = snap.cells.find(c => c.agentId === prevCell.agentId);
        if ((curr && prevCell.alive && !curr.alive) || (prevCell.alive && !currIds.has(prevCell.agentId))) {
          const key = `${side}|t${snap.turn}|death|${prevCell.agentId}`;
          if (!seenRef.current.has(key)) {
            seenRef.current.add(key);
            deaths += 1;
          }
        }
      }
      if (births > 0) playCue(ctx, 'birth');
      if (deaths > 0) setTimeout(() => playCue(ctx, 'death'), births > 0 ? 300 : 0);
    };
    fireFor(inputs.snapshotA, inputs.prevSnapshotA, 'a', lastTurnA);
    fireFor(inputs.snapshotB, inputs.prevSnapshotB, 'b', lastTurnB);
  }, [inputs.enabled, inputs.snapshotA, inputs.prevSnapshotA, inputs.snapshotB, inputs.prevSnapshotB]);

  // Forge approvals via the cumulative attempts array.
  useEffect(() => {
    if (!inputs.enabled) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    const fire = (atts: ForgeAttemptLike[], side: 'a' | 'b') => {
      for (const att of atts) {
        if (!att.approved) continue;
        const key = `${side}|forge|${att.turn}|${att.eventIndex}|${att.name}`;
        if (seenRef.current.has(key)) continue;
        seenRef.current.add(key);
        playCue(ctx, 'forge');
      }
    };
    fire(inputs.forgeAttemptsA, 'a');
    fire(inputs.forgeAttemptsB, 'b');
  }, [inputs.enabled, inputs.forgeAttemptsA, inputs.forgeAttemptsB]);
}
