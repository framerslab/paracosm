/**
 * GuidedTour — Scrimless walkthrough of the Paracosm dashboard.
 *
 * Highlights the target element with a pulsing amber outline.
 * No dark overlay — the full UI stays visible and alive.
 * A floating card annotates each highlighted section.
 */

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from 'react';
import styles from './GuidedTour.module.scss';

export type TourTab = 'quickstart' | 'studio' | 'sim' | 'viz' | 'chat' | 'reports' | 'library' | 'settings';

export interface TourStep {
  target: string;
  tab: TourTab;
  title: string;
  description: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-quickstart-seed]',
    tab: 'quickstart',
    title: 'Quickstart — author from a brief',
    description: 'Paste a brief, drop a PDF, or supply a URL. Paracosm grounds the prompt with web research, generates three distinct actors with HEXACO personalities, and runs them against the same scenario in parallel. The Twin demo card below runs a single subject against a single intervention if that\'s your use case.',
  },
  {
    target: '[role="tablist"][aria-label="Studio sub-navigation"]',
    tab: 'studio',
    title: 'Studio — author + branches',
    description: 'Drop any saved Paracosm artifact or bundle here to inspect, fork, and re-run. The Branches sub-tab forks an actor at any turn N and re-runs from that checkpoint with a new HEXACO profile, so you can probe alternate histories from a shared starting state.',
  },
  {
    target: '.topbar',
    tab: 'sim',
    title: 'Top Bar',
    description: 'Scenario name on the left. RUN, status, theme toggle, and HOW IT WORKS (replay this tour) on the right. The T / Y / S tokens in the center show turn, in-sim time, and deterministic seed — hover each for what they mean. A "⋯" menu reveals Save / Copy / Clear once a run has started.',
  },
  {
    target: '.tab-bar',
    tab: 'sim',
    title: 'Navigation',
    description: 'Quickstart and Studio for authoring. Sim, Viz, Chat for the live run. Reports and Library for analysis. Settings holds config (Event Log lives there as a sub-tab). Labels collapse to icons below 900px so the row never wraps onto two lines.',
  },
  {
    target: '[role="group"][aria-label="Sim layout"]',
    tab: 'sim',
    title: 'Sim layout',
    description: 'Side-by-side for 2 actors, Constellation for 3+. Constellation auto-engages above 3 actors because two columns physically can\'t fit them. Click any node in the Constellation graph to drill into one actor\'s decisions, departments, and tools. The tour pins side-by-side so you can see leader cards and event streams as they\'d render for a 2-actor run.',
  },
  {
    target: '.leaders-row',
    tab: 'sim',
    title: 'Leader cards',
    description: 'Each actor renders with its name, archetype, HEXACO profile, and a population + morale sparkline. Left is amber, right is teal. Glyph color, Conway tiles, and chronicle pills downstream all pick up these same colors so you always know which side you\'re looking at.',
  },
  {
    target: '.sim-columns',
    tab: 'sim',
    title: 'Event streams',
    description: 'Each turn, both leaders face events the Director generated based on accumulated state. Departments analyze in parallel and may forge new tools. Commanders decide. Tools tint by side. Every forged tool card gets a "↗ LOG" button that jumps to the Event Log filtered to that tool.',
  },
  {
    target: '[aria-label="Divergence rail"]',
    tab: 'sim',
    title: 'Divergence rail',
    description: 'How far the actors have diverged at the current turn. Shows decision texts and outcomes side by side in plain language. Same seed, different histories — because HEXACO shaped every LLM call.',
  },
  {
    target: '.viz-content',
    tab: 'viz',
    title: 'Viz — living canvas',
    description: 'Mirrored canvases, one per actor. Conway-style cellular tiles render underneath to encode mood (BLOCK = calm, GLIDER = agitated) while colonist glyphs sit on top as the primary signal. Hover a tile or a glyph for a tooltip; click either to drill into the colonist. Use the mode pills (LIVING / MOOD / FORGE / ECOLOGY / DIVERGENCE) and event filters above the canvas to reshape the read.',
  },
  {
    target: '.chat-layout',
    tab: 'chat',
    title: 'Character chat',
    description: 'Talk to any colonist from the run. Each carries their HEXACO profile, the memories they formed during the sim, and their relationships. The Viz drilldown popover has a direct Chat handoff that preselects the colonist here.',
  },
  {
    target: '.reports-content',
    tab: 'reports',
    title: 'Reports',
    description: 'Turn-by-turn rollup: commander decisions, department analyses, forged toolbox across both sides, agent reactions, verdict comparison. Every forged tool has a "↗ LOG" button that scopes the Event Log sub-tab to just that tool\'s history.',
  },
  {
    target: '[role="group"][aria-label="View mode"]',
    tab: 'library',
    title: 'Library — saved runs',
    description: 'Every run you launch is saved here. Filter by scenario, leader configuration, or free-text search. Gallery view shows hero stats; Table view shows everything. Open any run to inspect, or promote it into Studio to fork a new branch.',
  },
  {
    target: '[role="tablist"][aria-label="Settings sub-navigation"]',
    tab: 'settings',
    title: 'Settings + event log',
    description: 'Configure actors with HEXACO sliders, pick a scenario, set turns and population, and drop in your own OpenAI or Anthropic key to bypass the hosted-demo caps. The Event Log sub-tab shows the raw SSE stream (status, turn_start, specialist_done, decision_made, outcome, reaction, forge_attempt) and is what the "↗ LOG" buttons elsewhere link into.',
  },
  {
    target: '.topbar',
    tab: 'sim',
    title: 'Ready to launch',
    description: 'That was demo data. Hit RUN in the top bar to launch a live simulation against the host caps, or paste your own API key in Settings for full-scope runs. When the run finishes, a "Run Complete" banner lands at the top with the verdict and a jump to the Reports tab.',
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_W = 360;
const HIGHLIGHT_CLASS = 'tour-highlight';

const TOUR_STYLES = `
/* The highlighted element gets a bright luminous amber glow */
.${HIGHLIGHT_CLASS} {
  outline: 3px solid var(--amber) !important;
  outline-offset: 8px !important;
  box-shadow:
    0 0 20px rgba(232,180,74,.7),
    0 0 50px rgba(232,180,74,.4),
    0 0 100px rgba(232,180,74,.2),
    inset 0 0 30px rgba(232,180,74,.08) !important;
  position: relative !important;
  z-index: 99998 !important;
  filter: brightness(1.15) !important;
  animation: tour-pulse 2s ease-in-out infinite !important;
}
@keyframes tour-pulse {
  0%, 100% {
    outline-color: var(--amber);
    box-shadow: 0 0 20px rgba(232,180,74,.7), 0 0 50px rgba(232,180,74,.4), 0 0 100px rgba(232,180,74,.2), inset 0 0 30px rgba(232,180,74,.08);
  }
  50% {
    outline-color: rgba(232,180,74,1);
    box-shadow: 0 0 30px rgba(232,180,74,.9), 0 0 70px rgba(232,180,74,.55), 0 0 120px rgba(232,180,74,.3), inset 0 0 40px rgba(232,180,74,.12);
  }
}
`;

interface GuidedTourProps {
  /** The dashboard's currently-active tab. Threaded in so the tour can
   *  defer its DOM lookup until React has actually committed the tab
   *  change requested by onTabChange — without this, the lookup races
   *  ahead of the new tab's mount on slow viewports and lands on either
   *  the previous tab's elements or a stale empty container. */
  activeTab: TourTab | string;
  /** Whether the active scenario exposes Character Chat. When false the
   *  TabBar hides the Chat tab entirely; the tour drops its Chat step
   *  to match so it doesn't navigate to a tab the user can't reach
   *  via any other path. */
  chatEnabled?: boolean;
  onTabChange: (tab: TourTab) => void;
  onClose: () => void;
  onRun?: () => void;
}

export function GuidedTour({ activeTab, chatEnabled = true, onTabChange, onClose, onRun }: GuidedTourProps) {
  // Drop the Chat step on scenarios where Character Chat is disabled.
  // Without this filter the tour would fire onTabChange('chat') and the
  // ChatPanel (always mounted but hidden) would surface a tab the user
  // has no other way to reach.
  const steps = useMemo(
    () => (chatEnabled ? TOUR_STEPS : TOUR_STEPS.filter(s => s.tab !== 'chat')),
    [chatEnabled],
  );
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  // Re-render the card layout when the viewport crosses the mobile
  // breakpoint (e.g. user rotates device). The measure() resize handler
  // already re-positions the highlight; this state ensures the card's
  // mobile/desktop branch also flips on the same boundary.
  const [viewportW, setViewportW] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));
  const prevElRef = useRef<Element | null>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const rafRef = useRef(0);
  const current = steps[step];

  // Inject tour styles on mount, remove on unmount
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = TOUR_STYLES;
    document.head.appendChild(style);
    styleRef.current = style;
    return () => {
      style.remove();
      document.querySelector(`.${HIGHLIGHT_CLASS}`)?.classList.remove(HIGHLIGHT_CLASS);
    };
  }, []);

  // Drive the tab change as a separate effect so it fires the moment
  // step changes, independent of any other dep. Earlier this was bundled
  // into measure() and the lookup race, which left a window where the
  // user could observe a step that hadn't yet pushed its onTabChange
  // through to App.activeTab — making the URL bar lag behind the tour
  // card's "VIZ" / "STUDIO" / etc. badge.
  useEffect(() => {
    const s = steps[step];
    if (s) onTabChange(s.tab);
  }, [step, onTabChange, steps]);

  // Auto-dismiss when the user manually navigates to a tab the current
  // step doesn't target. Without this, clicking VIZ while parked on
  // (e.g.) the quickstart step leaves the viewport-wide SVG scrim
  // painted on a tab where the highlight target doesn't exist — the
  // user sees a permanent dim wash with no card and no obvious
  // dismissal affordance. Short delay lets tour-driven onTabChange
  // settle before we judge "mismatched" (without it the step-change
  // effect above briefly desyncs activeTab and aborts the tour
  // mid-progression).
  useEffect(() => {
    const s = steps[step];
    if (!s || s.tab === activeTab) return;
    const t = setTimeout(() => {
      const stillMismatched = steps[step]?.tab !== activeTab;
      if (stillMismatched) onClose();
    }, 200);
    return () => clearTimeout(t);
  }, [activeTab, step, steps, onClose]);

  // Highlight target element and measure its rect.
  const attemptCancelRef = useRef<(() => void) | null>(null);
  const measure = useCallback(() => {
    const s = steps[step];
    if (!s) return;

    attemptCancelRef.current?.();

    // Strip the previous step's highlight IMMEDIATELY so the new step
    // never renders its title/copy with the previous step's element
    // glowing. The polling loop below can take 100-3000ms to find a
    // target on a slow or off-tab mount; without this clear the user
    // sees "Divergence rail" in the tour card while "Event streams"
    // (the prior step's target) still glows. Same desync also showed
    // up when the user hit Back from the next step — the prior new
    // highlight stuck around because apply() only swaps when the new
    // target is found.
    if (prevElRef.current) {
      prevElRef.current.classList.remove(HIGHLIGHT_CLASS);
      prevElRef.current = null;
    }
    setRect(null);

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      let cancelled = false;
      let pollHandle: number | undefined;
      let observer: MutationObserver | undefined;
      const apply = (el: Element) => {
        if (cancelled) return;
        cancelled = true;
        if (pollHandle !== undefined) clearTimeout(pollHandle);
        observer?.disconnect();
        if (prevElRef.current && prevElRef.current !== el) {
          prevElRef.current.classList.remove(HIGHLIGHT_CLASS);
        }
        el.classList.add(HIGHLIGHT_CLASS);
        prevElRef.current = el;
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        if (r.top < 0 || r.bottom > window.innerHeight) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      };
      let attempt = 0;
      const MAX_ATTEMPTS = 30;
      const POLL_MS = 100;
      const tryFind = () => {
        if (cancelled) return;
        const el = document.querySelector(s.target);
        if (el) {
          apply(el);
          return;
        }
        if (++attempt < MAX_ATTEMPTS) {
          pollHandle = window.setTimeout(tryFind, POLL_MS);
        } else if (!cancelled) {
          cancelled = true;
          observer?.disconnect();
          if (prevElRef.current) {
            prevElRef.current.classList.remove(HIGHLIGHT_CLASS);
            prevElRef.current = null;
          }
          setRect(null);
        }
      };
      observer = new MutationObserver(() => {
        if (cancelled) return;
        const el = document.querySelector(s.target);
        if (el) apply(el);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      tryFind();
      attemptCancelRef.current = () => {
        cancelled = true;
        if (pollHandle !== undefined) clearTimeout(pollHandle);
        observer?.disconnect();
      };
    });
  }, [step, steps]);

  useEffect(() => {
    measure();
    let resizeRaf = 0;
    const h = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        setViewportW(window.innerWidth);
        measure();
      });
    };
    window.addEventListener('resize', h);
    return () => {
      window.removeEventListener('resize', h);
      cancelAnimationFrame(resizeRaf);
      cancelAnimationFrame(rafRef.current);
    };
  }, [measure, activeTab]);

  const handleClose = useCallback(() => {
    if (prevElRef.current) {
      prevElRef.current.classList.remove(HIGHLIGHT_CLASS);
      prevElRef.current = null;
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        step < steps.length - 1 ? setStep(s => s + 1) : handleClose();
      } else if (e.key === 'ArrowLeft' && step > 0) setStep(s => s - 1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [step, handleClose, steps.length]);

  if (!current) return null;

  const vw = viewportW;
  const vh = typeof window === 'undefined' ? 768 : window.innerHeight;
  const isMobile = vw < 640;

  // Compute card position via CSS custom properties so the static styles
  // live in the SCSS module while runtime values flow through inline.
  // Threshold reflects the real card footprint, not just header chrome:
  // step 1 ("Quickstart — author from a brief") plus the 14-step
  // counter + tab badge + Skip/Next action row lands around 280px on
  // desktop, so a 200px "below" check happily placed the card in a
  // slot it could never fit. The card itself is also max-heighted +
  // overflow-y: auto in the SCSS so even worst-case anchors keep the
  // controls reachable, but biasing toward "above" / "right" first
  // avoids the awkward inner scroll on the most common targets.
  const CARD_MIN_VERTICAL_SLOT = 320;
  const cardVars: CSSProperties = {};
  if (!isMobile && rect) {
    const below = vh - (rect.top + rect.height + 10);
    const above = rect.top - 10;
    const right = vw - (rect.left + rect.width + 10);

    if (below >= CARD_MIN_VERTICAL_SLOT) {
      (cardVars as Record<string, string>)['--card-top'] = `${rect.top + rect.height + 16}px`;
      (cardVars as Record<string, string>)['--card-left'] = `${Math.max(16, Math.min(rect.left, vw - CARD_W - 16))}px`;
    } else if (above >= CARD_MIN_VERTICAL_SLOT) {
      (cardVars as Record<string, string>)['--card-bottom'] = `${vh - rect.top + 16}px`;
      (cardVars as Record<string, string>)['--card-left'] = `${Math.max(16, Math.min(rect.left, vw - CARD_W - 16))}px`;
    } else if (right >= CARD_W + 24) {
      (cardVars as Record<string, string>)['--card-left'] = `${rect.left + rect.width + 16}px`;
      (cardVars as Record<string, string>)['--card-top'] = `${Math.max(16, Math.min(rect.top, vh - CARD_MIN_VERTICAL_SLOT - 16))}px`;
    } else {
      (cardVars as Record<string, string>)['--card-bottom'] = '24px';
      (cardVars as Record<string, string>)['--card-right'] = '24px';
    }
  } else if (!isMobile) {
    (cardVars as Record<string, string>)['--card-bottom'] = '24px';
    (cardVars as Record<string, string>)['--card-right'] = '24px';
  }

  const pad = 10;
  const cardCls = [styles.card, isMobile ? styles.mobile : ''].filter(Boolean).join(' ');

  return (
    <>
      {/* Dim overlay with cutout around highlighted element. Mounts
       * only while the tour is active (App.tsx gates this whole
       * component on `tourActive`). */}
      <div data-tour-overlay className={styles.svgOverlay}>
        <svg width="100%" height="100%" className={styles.svgFill}>
          <defs>
            <mask id="tour-mask">
              <rect width="100%" height="100%" fill="white" />
              {rect && (
                <rect
                  x={rect.left - pad} y={rect.top - pad}
                  width={rect.width + pad * 2} height={rect.height + pad * 2}
                  rx="10" fill="black"
                />
              )}
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#tour-mask)" />
        </svg>
      </div>

      {/* Click-away layer */}
      <div data-tour-overlay className={styles.clickAway} onClick={handleClose} />

      {/* Tour card */}
      <div data-tour-overlay className={cardCls} style={cardVars} onClick={e => e.stopPropagation()} role="dialog" aria-label="Guided tour">
        <div className={styles.cardHeader}>
          <span className={styles.stepCount}>
            {step + 1} / {steps.length}
          </span>
          <span aria-label={`Active tab: ${current.tab}`} className={styles.tabBadge}>
            {current.tab}
          </span>
          <button onClick={handleClose} className={styles.closeBtn} aria-label="Close tour">&times;</button>
        </div>

        <h3 className={[styles.title, isMobile ? styles.mobile : ''].filter(Boolean).join(' ')}>
          {current.title}
        </h3>
        <p className={[styles.description, isMobile ? styles.mobile : ''].filter(Boolean).join(' ')}>
          {current.description}
        </p>

        <div className={styles.actions}>
          <button onClick={handleClose} className={[styles.skipBtn, isMobile ? styles.compact : ''].filter(Boolean).join(' ')}>Skip</button>
          <div className={styles.actionsRight}>
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)} className={[styles.navBtn, isMobile ? styles.compact : ''].filter(Boolean).join(' ')}>
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (step < steps.length - 1) {
                  setStep(s => s + 1);
                } else {
                  handleClose();
                  onRun?.();
                }
              }}
              className={[
                styles.primaryBtn,
                isMobile ? styles.compact : '',
                !isMobile && step === steps.length - 1 ? styles.final : '',
              ].filter(Boolean).join(' ')}
            >
              {step < steps.length - 1 ? 'Next' : isMobile ? 'Start →' : 'Start Your Simulation'}
            </button>
          </div>
        </div>

        {/* Thin progress bar (mobile) or dot row (desktop). */}
        {isMobile ? (
          <div className={styles.progressBar}>
            <div
              className={styles.progressBarFill}
              style={{ '--progress-pct': `${((step + 1) / steps.length) * 100}%` } as CSSProperties}
              role="progressbar"
              aria-valuenow={step + 1}
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-label={`Step ${step + 1} of ${steps.length}`}
            />
          </div>
        ) : (
          <div className={styles.dotRow}>
            {steps.map((_, i) => (
              <button
                key={i} onClick={() => setStep(i)}
                className={styles.dot}
                style={{
                  '--dot-width': i === step ? '16px' : '6px',
                  '--dot-bg': i === step ? 'var(--amber)' : i < step ? 'var(--text-3)' : 'var(--border)',
                } as CSSProperties}
                aria-label={`Step ${i + 1}`}
              />
            ))}
          </div>
        )}

        {!isMobile && (
          <div className={styles.kbHint}>Arrow keys / Esc</div>
        )}
      </div>
    </>
  );
}
