import * as React from 'react';
import { useState, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** Show a small amber dot indicator that this element has a tooltip */
  dot?: boolean;
  /** Render the wrapper as block-level so it fills its container (used by
   *  full-width row triggers like CrisisHeader where the inline-flex
   *  default would otherwise shrink-to-content). */
  block?: boolean;
}

/**
 * Rendered tooltip width. Kept in sync with the style declaration below
 * so the positioning clamp and the actual rendered size agree. Previously
 * the clamp used 380px while the card rendered at 420px, which meant the
 * right edge could overflow the viewport by up to 40px before the clamp
 * kicked in. Moved to a constant so future width changes only touch one
 * place.
 */
const TOOLTIP_WIDTH = 420;
const TOOLTIP_MAX_HEIGHT_ESTIMATE = 260;

export function Tooltip({ content, children, dot, block }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ESC dismisses the tooltip while it's open. Without this, keyboard
  // users who Tab onto a tooltipped element have to Tab away to dismiss
  // (or wait for the blur timeout). Common AT pattern per ARIA APG.
  React.useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setVisible(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible]);

  const show = useCallback((e: React.MouseEvent) => {
    clearTimeout(timer.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const tooltipW = Math.min(TOOLTIP_WIDTH, window.innerWidth - 20);
    let x = rect.left;
    // Default: position ABOVE the element
    let y = rect.top - TOOLTIP_MAX_HEIGHT_ESTIMATE - 6;
    // If no room above, flip below
    if (y < 10) y = rect.bottom + 6;
    // Clamp to viewport
    if (x + tooltipW > window.innerWidth - 10) x = window.innerWidth - tooltipW - 10;
    if (x < 10) x = 10;
    if (y + TOOLTIP_MAX_HEIGHT_ESTIMATE > window.innerHeight - 10) y = window.innerHeight - TOOLTIP_MAX_HEIGHT_ESTIMATE - 10;
    if (y < 10) y = 10;
    setPos({ x, y });
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    timer.current = setTimeout(() => setVisible(false), 100);
  }, []);

  // Render the floating tooltip into document.body via a portal.
  //
  // Why: several callers render the tooltip trigger inside containers
  // that apply CSS transforms (e.g. EventCard forge cards use
  // `animation: forgeSlide` with `transform: translateX()` and fill mode
  // `both`, which keeps `transform: translateX(0)` applied after the
  // animation completes). Any non-static transform on an ancestor turns
  // `position: fixed` into "fixed relative to that ancestor," which
  // caused the tooltip to be clipped at the card's edges. The user saw
  // this as text cut off mid-word ("✓ PASS · judge co...").
  //
  // Portaling into document.body removes the tooltip from the trigger's
  // ancestor chain entirely, so position:fixed resolves against the
  // viewport as intended.
  const floatingTooltip = visible ? (
    <div
      id="paracosm-tooltip"
      role="tooltip"
      onMouseEnter={() => { clearTimeout(timer.current); setVisible(true); }}
      onMouseLeave={hide}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 99999,
        background: 'var(--bg-card)', border: '2px solid var(--amber)', borderRadius: '8px',
        padding: '14px 18px', fontSize: 'var(--font-sm)', color: 'var(--text-1)', lineHeight: 1.6,
        width: `${TOOLTIP_WIDTH}px`, maxWidth: '90vw',
        // Cap height so an overflowing tooltip scrolls internally rather
        // than overflowing the viewport. Previously the no-scroll policy
        // could push tooltip content below the viewport when the text
        // body ran long (FAIL tooltip with a verbose rejection reason).
        maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,.4)', pointerEvents: 'auto',
        whiteSpace: 'normal', wordBreak: 'break-word',
        animation: 'fadeUp 0.15s ease both',
      }}
    >
      {content}
    </div>
  ) : null;

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{
        position: 'relative',
        display: block ? 'block' : 'inline-flex',
        alignItems: block ? undefined : 'center',
        width: block ? '100%' : undefined,
        minWidth: block ? 0 : undefined,
        cursor: 'pointer',
      }}
      // Tooltip is a hover/focus disclosure, not a button. With
      // role="button" axe flagged nested-interactive whenever children
      // were also interactive (most callers wrap a <button>).
      // Keeping tabIndex=0 lets keyboard users still focus + surface
      // the tooltip when children are NON-interactive (a plain <span>
      // metric, etc); when children ARE interactive their own tabstop
      // bubbles focus up via onFocus, so the surface still triggers.
      tabIndex={0}
      aria-describedby={visible ? 'paracosm-tooltip' : undefined}
      onFocus={show as unknown as React.FocusEventHandler}
      onBlur={hide}
    >
      {children}
      {dot && (
        <span style={{
          width: '6px', height: '6px', borderRadius: '50%', background: 'var(--amber)',
          opacity: visible ? 0.8 : 0, marginLeft: '3px', transition: 'opacity 0.15s',
          flexShrink: 0, display: 'inline-block', verticalAlign: 'middle',
        }} aria-hidden="true" />
      )}
      {/* SSR safety: document is only referenced inside the render
          function body, which runs on the client. If this component ever
          gets rendered in a SSR context the `typeof document` guard
          returns null early without crashing. */}
      {floatingTooltip && typeof document !== 'undefined'
        ? createPortal(floatingTooltip, document.body)
        : null}
    </span>
  );
}
