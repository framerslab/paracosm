import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { renderTsRecipe, renderCurlRecipe, type RecipeInput } from './view-as-code.js';
import styles from './ViewAsCodePanel.module.scss';

// `import * as React` keeps the SSR test runner happy. The dashboard's
// tsconfig sets `jsx: 'react-jsx'` so React is not directly referenced
// in compiled JSX, but `node --import tsx` falls through a different
// JSX transform path during the unit-test run that still expects
// `React` to be in scope (matches SimLayoutToggle and other tested
// components in this tree). Without this line, `node --test` errors
// with "ReferenceError: React is not defined" on render.
void React;

type Tab = 'ts' | 'curl';

interface ViewAsCodePanelProps extends RecipeInput {
  /** Mirrors the Quickstart input row's disabled flag. The toggle and
   *  copy stay clickable when disabled (the run that just kicked off
   *  is a perfectly good thing to copy a recipe of) but the toggle
   *  picks up a dimmed hover treatment for visual parity. */
  disabled?: boolean;
  /** Test seam: when set, the panel mounts already expanded. Production
   *  callers should leave this undefined so the panel starts collapsed. */
  initiallyExpanded?: boolean;
  /** Test seam: pre-select a tab. */
  initialTab?: Tab;
}

/**
 * Collapsible panel that renders the Quickstart form state as a
 * TypeScript or curl recipe. Mounted as a child of <SeedInput> between
 * the actor-count row and the run button.
 */
export function ViewAsCodePanel(props: ViewAsCodePanelProps) {
  const { disabled, initiallyExpanded = false, initialTab = 'ts', ...recipeState } = props;
  const [expanded, setExpanded] = useState<boolean>(initiallyExpanded);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');

  const tsCode = useMemo(
    () => renderTsRecipe(recipeState),
    [recipeState.seedText, recipeState.domainHint, recipeState.sourceUrl, recipeState.actorCount],
  );
  const curlCode = useMemo(
    () => renderCurlRecipe(recipeState),
    [recipeState.seedText, recipeState.domainHint, recipeState.sourceUrl, recipeState.actorCount],
  );
  const activeCode = tab === 'ts' ? tsCode : curlCode;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopyState('ok');
    } catch {
      setCopyState('fail');
    }
    window.setTimeout(() => setCopyState('idle'), 1500);
  }, [activeCode]);

  const panelId = 'quickstart-view-as-code-panel';
  const tsTabId = 'quickstart-view-as-code-tab-ts';
  const curlTabId = 'quickstart-view-as-code-tab-curl';
  const activeTabId = tab === 'ts' ? tsTabId : curlTabId;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? '▾ Hide code' : '▸ View as code'}
      </button>

      {expanded && (
        <div
          id={panelId}
          role="tabpanel"
          aria-labelledby={activeTabId}
          className={styles.panel}
        >
          <div className={styles.tabRow} role="tablist" aria-label="Recipe language">
            <button
              type="button"
              id={tsTabId}
              role="tab"
              aria-pressed={tab === 'ts'}
              aria-selected={tab === 'ts'}
              aria-controls={panelId}
              className={styles.tabPill}
              onClick={() => setTab('ts')}
            >
              TypeScript
            </button>
            <button
              type="button"
              id={curlTabId}
              role="tab"
              aria-pressed={tab === 'curl'}
              aria-selected={tab === 'curl'}
              aria-controls={panelId}
              className={styles.tabPill}
              onClick={() => setTab('curl')}
            >
              curl
            </button>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={handleCopy}
              aria-label={`Copy ${tab === 'ts' ? 'TypeScript' : 'curl'} recipe`}
            >
              {copyState === 'ok' ? 'Copied ✓' : copyState === 'fail' ? 'Press ⌘C' : 'Copy'}
            </button>
          </div>
          <pre className={styles.code}><code>{activeCode}</code></pre>
        </div>
      )}
    </div>
  );
}
