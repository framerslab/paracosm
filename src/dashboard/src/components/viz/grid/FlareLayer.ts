import type { ActiveFlare } from './flareQueue.js';

const FLARE_COLORS: Record<string, string> = {
  birth: 'rgba(154, 205, 96, 0.8)',
  death: 'rgba(168, 152, 120, 0.7)',
  forge_approved: 'rgba(232, 180, 74, 0.8)',
  forge_rejected: 'rgba(224, 101, 48, 0.7)',
  reuse: 'rgba(232, 180, 74, 0.6)',
  crisis: 'rgba(196, 74, 30, 0.8)',
};

/** Particle count for birth/death flourish. Evenly angled around the
 *  source so the pattern is organic but not symmetric. */
const PARTICLE_COUNT = 6;

/** Draw visible flare symbols + rings + particles on top of the RD
 *  field. Birth/death flares now scatter drifting particles outward
 *  so events feel more alive than a plain expanding ring. */
export function drawFlares(ctx: CanvasRenderingContext2D, flares: ActiveFlare[]): void {
  ctx.save();
  for (const f of flares) {
    const color = FLARE_COLORS[f.kind] ?? 'rgba(255,255,255,0.6)';
    const t = f.progress;
    const fade = 1 - t;
    ctx.globalAlpha = fade;
    if (f.kind === 'birth' || f.kind === 'death' || f.kind === 'crisis') {
      const r = 4 + t * 14;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.stroke();

      if (f.kind !== 'crisis') {
        // Drifting particles — deterministic angles so the pattern is
        // stable as frames tick (no jittery re-randomization).
        const particleR = 2 + t * 22;
        const particleSize = f.kind === 'birth' ? 1.8 : 1.4;
        ctx.fillStyle = color;
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const ang = (i / PARTICLE_COUNT) * Math.PI * 2 + (f.kind === 'birth' ? 0.3 : -0.2);
          const px = f.x + Math.cos(ang) * particleR;
          const py = f.y + Math.sin(ang) * particleR;
          ctx.globalAlpha = fade * 0.9;
          ctx.beginPath();
          ctx.arc(px, py, particleSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (f.kind === 'reuse' && typeof f.endX === 'number' && typeof f.endY === 'number') {
      // Comet head: bright core + outer glow traveling along the curve.
      const cx = f.x + (f.endX - f.x) * t;
      const cy = f.y + (f.endY - f.y) * t;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8);
      glow.addColorStop(0, 'rgba(248, 225, 150, 0.95)');
      glow.addColorStop(0.4, color);
      glow.addColorStop(1, 'rgba(232, 180, 74, 0)');
      ctx.fillStyle = glow;
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
      // Solid core.
      ctx.fillStyle = 'rgba(248, 225, 150, 0.95)';
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
