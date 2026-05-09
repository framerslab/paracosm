import type { CSSProperties } from 'react';
import type { ProviderErrorState } from '../../hooks/useSSE';
import styles from './ProviderErrorBanner.module.scss';

/**
 * Persistent banner shown at the top of the dashboard when a simulation
 * hit a terminal provider error (quota exhausted, invalid API key).
 *
 * This is deliberately NOT a toast because:
 *   1. Toasts auto-dismiss; the underlying account problem does not.
 *   2. Toasts disappear when the user switches tabs; the banner survives
 *      tab navigation and any further runs until the user dismisses it or
 *      clears state.
 *   3. The message has actionable content (billing URL, provider docs)
 *      that the user needs to click, and click targets should not fade.
 *
 * Rendered inline at the top of the app shell above TopBar so it is
 * visible no matter which tab is active.
 *
 * Uses inline styles to stay consistent with the rest of the dashboard's
 * inline-styled layout components; the banner has no SCSS module.
 */
export function ProviderErrorBanner({
  providerError,
  onDismiss,
}: {
  providerError: ProviderErrorState;
  onDismiss?: () => void;
}) {
  // Color scheme differs by severity. Quota and auth are the terminal
  // kinds we actually abort on, so they both get the red treatment. Rate
  // limit / network / unknown are informational (we keep running) so they
  // would never reach the banner as-is — but we handle them defensively
  // in case future code paths surface non-terminal classifications here.
  const severity = providerError.kind === 'quota' || providerError.kind === 'auth' ? 'critical' : 'warning';

  const colors = severity === 'critical'
    ? {
        bg: 'rgba(196, 74, 30, 0.14)',
        border: 'var(--red, #c44a1e)',
        text: 'var(--red, #c44a1e)',
        actionBg: 'var(--red, #c44a1e)',
        actionText: 'var(--bg-primary, #14110e)',
      }
    : {
        bg: 'rgba(232, 180, 74, 0.14)',
        border: 'var(--amber, #e8b44a)',
        text: 'var(--amber, #e8b44a)',
        actionBg: 'var(--amber, #e8b44a)',
        actionText: 'var(--bg-primary, #14110e)',
      };

  // Per-kind heading. Kept short so the banner fits one line on mobile.
  const heading = providerError.kind === 'quota'
    ? `${providerLabel(providerError.provider)} credits exhausted`
    : providerError.kind === 'auth'
      ? `${providerLabel(providerError.provider)} API key invalid`
      : providerError.kind === 'rate_limit'
        ? `${providerLabel(providerError.provider)} rate-limited`
        : providerError.kind === 'network'
          ? `Network error contacting ${providerLabel(providerError.provider)}`
          : 'Provider error';

  const bannerVars = {
    '--banner-bg': colors.bg,
    '--banner-border': colors.border,
    '--banner-text': colors.text,
    '--action-bg': colors.actionBg,
    '--action-text': colors.actionText,
  } as CSSProperties;

  return (
    <div role="alert" aria-live="assertive" className={styles.banner} style={bannerVars}>
      <span aria-hidden="true" className={styles.icon}>!</span>
      <div className={styles.body}>
        <div className={styles.heading}>{heading}</div>
        <div className={styles.message}>
          {providerError.message}
          {providerError.leader ? (
            <span className={styles.messageActor}> (hit by {providerError.leader})</span>
          ) : null}
        </div>
      </div>
      {providerError.actionUrl ? (
        <a
          href={providerError.actionUrl}
          target="_blank"
          rel="noreferrer noopener"
          className={styles.actionLink}
        >
          {providerError.kind === 'quota' ? 'Add credits →' : 'Fix key →'}
        </a>
      ) : null}
      {onDismiss ? (
        <button onClick={onDismiss} aria-label="Dismiss banner" className={styles.dismissBtn}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

function providerLabel(provider?: string): string {
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'openrouter') return 'OpenRouter';
  if (provider === 'gemini') return 'Gemini';
  return 'Provider';
}
