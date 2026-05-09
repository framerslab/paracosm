interface VizControlsProps {
  currentTurn: number;
  maxTurn: number;
  time: number;
  playing: boolean;
  speed: number;
  onTurnChange: (turn: number) => void;
  onPlayPause: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onSpeedChange: (speed: number) => void;
}

const SPEEDS = [0.5, 1, 2, 4];

/**
 * Minimal playback controls row: step back, play/pause, step forward,
 * scrub slider, speed selector. Mode + layout + divergence toggles
 * retired; those moved into the visible ClusterToggleRow and D-key
 * shortcut.
 */
export function VizControls({
  currentTurn, maxTurn, time, playing, speed,
  onTurnChange, onPlayPause, onStepBack, onStepForward, onSpeedChange,
}: VizControlsProps) {
  const buttonStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    color: 'var(--text-2)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '4px 10px',
    fontFamily: 'var(--mono)',
    fontSize: 'var(--font-xs)',
    cursor: 'pointer',
  };
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border)',
      }}
    >
      <button type="button" onClick={onStepBack} disabled={currentTurn <= 0} aria-label="Previous turn" style={buttonStyle}>
        {'<<'}
      </button>
      <button type="button" onClick={onPlayPause} disabled={maxTurn <= 1} aria-label={playing ? 'Pause' : 'Play'} style={buttonStyle}>
        {playing ? '\u25A0' : '\u25B6'}
      </button>
      <button type="button" onClick={onStepForward} disabled={currentTurn >= maxTurn - 1} aria-label="Next turn" style={buttonStyle}>
        {'>>'}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(0, maxTurn - 1)}
        value={currentTurn}
        onChange={e => onTurnChange(Number(e.target.value))}
        style={{ flex: 1 }}
        aria-label="Scrub timeline"
      />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--font-2xs)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
        T{currentTurn + 1}/{maxTurn} {time ? `\u00b7 ${time}` : ''}
      </span>
      <select
        aria-label="Playback speed"
        value={speed}
        onChange={e => onSpeedChange(Number(e.target.value))}
        style={{ fontFamily: 'var(--mono)', fontSize: 'var(--font-2xs)', background: 'var(--bg-card)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}
      >
        {SPEEDS.map(s => (
          <option key={s} value={s}>{s}x</option>
        ))}
      </select>
    </div>
  );
}
