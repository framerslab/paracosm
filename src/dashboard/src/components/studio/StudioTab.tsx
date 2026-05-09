/**
 * Studio tab — drag-drop a RunArtifact JSON, render via the existing
 * static-mode adapters, and expose Promote-to-Library + Compare-against-
 * Library actions.
 *
 * @module paracosm/dashboard/studio/StudioTab
 */
import * as React from 'react';
import styles from './StudioTab.module.scss';
import { StudioDropZone } from './StudioDropZone.js';
import { StudioGuide } from './StudioGuide.js';
import { StudioArtifactView } from './StudioArtifactView.js';
import { StudioBundleView } from './StudioBundleView.js';
import { useStudioPromote, type PromoteResult } from './useStudioPromote.js';
import { CompareModal } from '../compare/CompareModal.js';
import { BranchesTab } from '../branches/BranchesTab.js';
import { SubTabNav } from '../shared/SubTabNav.js';
import { setSubTabUrlParam } from '../../tab-routing.js';
import type { StudioInput } from './parseStudioInput.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

type StudioSubTab = 'author' | 'branches';

const STUDIO_SUB_TABS = [
  { id: 'author' as const, label: 'Author' },
  { id: 'branches' as const, label: 'Branches' },
];

interface LoadedState {
  input: Extract<StudioInput, { kind: 'single' | 'bundle' }>;
  filename: string;
  promote: PromoteResult | null;
}

export interface StudioTabProps {
  /** Sub-tab to land on when the tab mounts. Used by tab-routing
   *  redirects: `?tab=branches` lands on `studio?subTab=branches`
   *  for backward compat with deep links from before the merge. */
  initialSubTab?: StudioSubTab;
}

export function StudioTab({ initialSubTab = 'author' }: StudioTabProps = {}): JSX.Element {
  const [subTab, setSubTab] = React.useState<StudioSubTab>(initialSubTab);
  // Persist the sub-tab choice in the URL so a page refresh or shared
  // link lands the user back on the same Branches / Author panel.
  // 'author' is the default; omit the param for that case so the URL
  // stays clean, only push '?sub=branches' for the non-default.
  const handleSubTabChange = React.useCallback((next: StudioSubTab) => {
    setSubTab(next);
    setSubTabUrlParam(next === 'author' ? null : next);
  }, []);
  const [loaded, setLoaded] = React.useState<LoadedState | null>(null);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const promote = useStudioPromote();

  const onLoaded = React.useCallback((input: StudioInput, filename: string) => {
    if (input.kind === 'error') return; // DropZone already surfaced the error
    setLoaded({ input, filename, promote: null });
  }, []);

  const onPromoteSingle = React.useCallback(async () => {
    if (!loaded || loaded.input.kind !== 'single') return;
    const result = await promote.promoteSingle(loaded.input.artifact);
    // Functional updater so a state change between the await and the
    // resolve (e.g. user dropped a different file) merges into the
    // latest state instead of overwriting it with the stale `loaded`.
    if (result) setLoaded((prev) => (prev ? { ...prev, promote: result } : prev));
  }, [loaded, promote]);

  const onPromoteBundle = React.useCallback(async () => {
    if (!loaded || loaded.input.kind !== 'bundle') return;
    const result = await promote.promoteBundle(loaded.input.artifacts);
    if (result) setLoaded((prev) => (prev ? { ...prev, promote: result } : prev));
  }, [loaded, promote]);

  const onCompare = React.useCallback(() => setCompareOpen(true), []);

  const reset = React.useCallback(() => {
    setLoaded(null);
    setCompareOpen(false);
  }, []);

  const extraArtifacts: RunArtifact[] | undefined = (() => {
    if (!loaded) return undefined;
    if (loaded.input.kind === 'single') return [loaded.input.artifact];
    return loaded.input.artifacts;
  })();

  // bundleId for CompareModal: prefer the freshly-Promoted bundleId
  // (so the bundle's full Library context loads). Otherwise null —
  // CompareModal renders the extras-only path.
  const compareBundleId: string | null = (() => {
    if (loaded?.promote?.kind === 'bundle') return loaded.promote.bundleId;
    return null;
  })();

  return (
    <div className={styles.tab}>
      <SubTabNav
        options={STUDIO_SUB_TABS}
        active={subTab}
        onChange={handleSubTabChange}
        ariaLabel="Studio sub-navigation"
      />
      {subTab === 'branches' && <BranchesTab />}
      {subTab === 'author' && !loaded && (
        <>
          <StudioGuide />
          <StudioDropZone onLoaded={onLoaded} />
        </>
      )}
      {subTab === 'author' && loaded && (
        <>
          <div className={styles.loadedBar}>
            <span>
              <strong>{loaded.filename}</strong>
              {' · '}
              {loaded.input.kind === 'single' ? 'single artifact' : `bundle of ${loaded.input.artifacts.length}`}
              {loaded.promote && (loaded.promote.kind === 'single'
                ? loaded.promote.alreadyExisted
                  ? ' · already in Library'
                  : ' · added to Library'
                : ` · added to Library (${loaded.promote.runIds.length} runs)`)}
            </span>
            <button type="button" className={styles.bundleDrillBack} onClick={reset}>
              Drop another
            </button>
          </div>
          {promote.error && (
            <div className={styles.errorBanner} role="alert">{promote.error}</div>
          )}
          {loaded.input.kind === 'single' && (
            <StudioArtifactView
              artifact={loaded.input.artifact}
              onPromote={onPromoteSingle}
              onCompare={onCompare}
              promoteBusy={promote.busy}
              alreadyExisted={loaded.promote?.kind === 'single' && loaded.promote.alreadyExisted}
            />
          )}
          {loaded.input.kind === 'bundle' && (
            <StudioBundleView
              artifacts={loaded.input.artifacts}
              bundleId={loaded.input.bundleId}
              onPromote={onPromoteBundle}
              onCompare={onCompare}
              promoteBusy={promote.busy}
              alreadyExisted={loaded.promote?.kind === 'bundle' && loaded.promote.alreadyExisted.every(Boolean)}
            />
          )}
        </>
      )}
      <CompareModal
        bundleId={compareBundleId}
        extraArtifacts={extraArtifacts}
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
      />
    </div>
  );
}
