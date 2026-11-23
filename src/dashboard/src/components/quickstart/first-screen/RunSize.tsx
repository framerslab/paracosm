/**
 * The run's size, in the leaders' heading row: the mark LEADERS and how
 * many leaders the run takes.
 *
 * A run on the host's keys is a pair, said in words with one line on how a
 * larger run is made. On the visitor's own key, or on a server that is not
 * the hosted demo, the size is a number from 2 to 300: a fewer key, a spin
 * button and a more key, in one row at every width. A typed number out of
 * range says so and returns to the nearest bound when the field loses
 * focus. Until the server's settings and the day's count have both
 * answered, the size reads as words, so a control never shows and then
 * goes. The control works with no network; while the run's leaders are
 * written or the run starts, it is locked.
 *
 * @module paracosm/dashboard/quickstart/first-screen/RunSize
 */
import { useId, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { payer, readLaunchSettings, safeLocalStorage } from './effectiveLaunch';
import { SectionMark, WarningGlyph } from './marks';
import { FREE_SIZE, RUN_SIZE_BOUNDS, clampSize, sizeMode, stepSize } from './runSize.helpers';
import { useServerFacts } from './useServerFacts';
import {
  FEWER_LEADERS,
  LEADERS_MARK,
  MORE_LEADERS,
  NUMBER_OF_LEADERS,
  SETTINGS_NOT_READ,
  chooseSize,
  fewestLine,
  freeSizeLine,
  leadersCount,
  mostLine,
} from './words';
import styles from './RunSize.module.scss';

export interface RunSizeProps {
  /** How many leaders the visitor chose, as the address holds it. */
  size: number;
  onSize: (size: number) => void;
  /** True while the run's leaders are written or the run starts: the size cannot change. */
  locked?: boolean;
}

/** A key's glyph: a bar, and for the more key a second bar across it. */
function StepGlyph({ plus }: { plus?: boolean }) {
  return (
    <svg className={styles.glyph} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M3 8h10" />
      {plus && <path d="M8 3v10" />}
    </svg>
  );
}

export function RunSize({ size, onSize, locked = false }: RunSizeProps) {
  const facts = useServerFacts();
  const boundId = useId();
  const refusalId = useId();
  /** The field's own text while it is being typed in; null while it shows the size. */
  const [typed, setTyped] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  // Read on each render: the Settings tab may have saved a key since.
  const settings = readLaunchSettings(safeLocalStorage());
  const who = payer(facts, settings.overrides);
  const mode = sizeMode({ payer: who, adminConfig: facts.adminConfig.status, rateLimit: facts.rateLimit.status });
  const bounds = RUN_SIZE_BOUNDS;

  const mark = (
    <p className={styles.mark} data-testid="leaders-mark">
      <SectionMark className={styles.triangle} />
      <span>{LEADERS_MARK}</span>
    </p>
  );

  if (mode !== 'control') {
    const shown = mode === 'pair' ? FREE_SIZE : size;
    // The free run's line is the hosted demo's; while the server has not said which it is, its place is held.
    const hostPaid = who === 'host';
    const unknown = mode === 'pair' && !hostPaid && facts.adminConfig.status === 'loading';
    return (
      <div className={styles.size} data-testid="run-size">
        <div className={styles.row} data-row="leaders heading">
          {mark}
          <p className={styles.value} data-testid="run-size-value">{leadersCount(shown)}</p>
        </div>
        {hostPaid && (
          <p className={styles.line} data-testid="run-size-line">{freeSizeLine({ free: FREE_SIZE, max: bounds.max })}</p>
        )}
        {unknown && (
          <p className={styles.line} aria-hidden="true">
            <span className={styles.shape} data-shape>{freeSizeLine({ free: FREE_SIZE, max: bounds.max })}</span>
          </p>
        )}
      </div>
    );
  }

  const atMin = size <= bounds.min;
  const atMax = size >= bounds.max;
  const change = (next: number) => {
    setTyped(null);
    setRefused(false);
    if (next !== size) onSize(next);
  };
  const onType = (event: ChangeEvent<HTMLInputElement>) => {
    if (locked) return;
    const raw = event.target.value;
    setTyped(raw);
    const next = clampSize(raw, bounds, size);
    setRefused(next.refused);
    if (!next.refused && next.value !== size) onSize(next.value);
  };
  const onLeave = () => {
    if (typed === null) return;
    // A number out of range goes to the nearest bound; anything else keeps the last good size.
    const next = clampSize(typed, bounds, size);
    setTyped(null);
    if (next.value !== size) onSize(next.value);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (locked) return;
    const next = event.key === 'ArrowUp' ? stepSize(size, 1, bounds)
      : event.key === 'ArrowDown' ? stepSize(size, -1, bounds)
        : event.key === 'PageUp' ? stepSize(size, 10, bounds)
          : event.key === 'PageDown' ? stepSize(size, -10, bounds)
            : event.key === 'Home' ? bounds.min
              : event.key === 'End' ? bounds.max
                : null;
    if (next === null) return;
    event.preventDefault();
    change(next);
  };
  const bound = atMin ? fewestLine(bounds.min) : atMax ? mostLine(bounds.max) : null;

  return (
    <div className={styles.size} data-testid="run-size">
      <div className={styles.row} data-row="leaders heading">
        {mark}
        <div className={styles.control}>
          <button
            type="button"
            className={styles.step}
            aria-label={FEWER_LEADERS}
            aria-disabled={atMin || locked ? 'true' : undefined}
            aria-describedby={atMin ? boundId : undefined}
            onClick={() => { if (!atMin && !locked) change(stepSize(size, -1, bounds)); }}
          >
            <StepGlyph />
          </button>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            role="spinbutton"
            className={styles.field}
            aria-label={NUMBER_OF_LEADERS}
            aria-valuemin={bounds.min}
            aria-valuemax={bounds.max}
            aria-valuenow={size}
            aria-invalid={refused && typed !== null ? 'true' : undefined}
            aria-describedby={refused ? refusalId : undefined}
            aria-disabled={locked ? 'true' : undefined}
            readOnly={locked}
            value={typed ?? String(size)}
            onChange={onType}
            onBlur={onLeave}
            onKeyDown={onKey}
          />
          <button
            type="button"
            className={styles.step}
            aria-label={MORE_LEADERS}
            aria-disabled={atMax || locked ? 'true' : undefined}
            aria-describedby={atMax ? boundId : undefined}
            onClick={() => { if (!atMax && !locked) change(stepSize(size, 1, bounds)); }}
          >
            <StepGlyph plus />
          </button>
        </div>
      </div>
      {bound && <p id={boundId} className={styles.line} data-testid="run-size-bound">{bound}</p>}
      {refused && (
        <p id={refusalId} className={styles.refusal} aria-live="polite" data-testid="run-size-error">
          <WarningGlyph className={styles.warning} />
          <span>{chooseSize(bounds)}</span>
        </p>
      )}
      {facts.adminConfig.status === 'error' && (
        <p className={styles.line} data-testid="run-size-settings">{SETTINGS_NOT_READ}</p>
      )}
    </div>
  );
}
