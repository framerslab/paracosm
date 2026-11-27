import * as React from 'react';
import { useCallback, useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import type { ScenarioClientPayload } from '../../hooks/useScenario';
import { createDashboardTabHref, type DashboardTab } from '../../tab-routing';
import { OneRowScroller } from '../shared/OneRowScroller';
import { MORE, PACKAGE_LINKS, MORE_TAB_LINES, NEXT_SECTIONS, PREVIOUS_SECTIONS, SECTIONS, TAB_NAMES } from './frameWords';
import { MoreMenu, type SectionMenuItem } from './MoreMenu';
import { useRowFit } from './useRowFit';
import styles from './TabBar.module.scss';

void React;

interface TabBarProps {
  active: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  scenario: ScenarioClientPayload;
  moreFirstLine: string | null;
  headerFold?: number;
}

const PRIMARY_TABS = ['quickstart', 'sim', 'reports'] as const;
const MENU_TABS = ['studio', 'viz', 'chat', 'library', 'settings', 'about'] as const;

function tabHref(tab: DashboardTab): string {
  if (tab === 'about') return '/';
  return typeof window === 'undefined' ? '/sim?tab=' + tab : createDashboardTabHref(window.location.href, tab);
}

export function TabBar({ active, onTabChange, scenario, moreFirstLine, headerFold = 0 }: TabBarProps) {
  const nav = useRef<HTMLElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const fold = useRowFit(nav, 2);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const previousTab = useRef(active);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) anchor.current?.focus();
  }, []);

  // A refold changes which tabs the menu holds, and can take away the item
  // that has focus: the menu closes, with focus back on More.
  const previousFold = useRef(fold);
  useLayoutEffect(() => {
    if (fold === previousFold.current) return;
    previousFold.current = fold;
    if (!open) return;
    const focus = document.activeElement;
    close(!focus || focus === document.body || !!focus.closest('[role="menu"]'));
  }, [close, fold, open]);

  useLayoutEffect(() => {
    if (active === previousTab.current) return;
    previousTab.current = active;
    if (open) close(!!document.activeElement?.closest('[role="menu"]'));
  }, [active, close, open]);

  const moreActive = !PRIMARY_TABS.some(tab => tab === active) || (fold > 0 && active === 'reports');
  const moreLabel = moreActive ? TAB_NAMES[active] : MORE;
  const items: SectionMenuItem[] = MENU_TABS
    .filter(tab => tab !== 'chat' || scenario.policies.characterChat)
    .map(tab => ({
      tab,
      label: TAB_NAMES[tab],
      description: MORE_TAB_LINES[tab],
      href: tabHref(tab),
      current: tab === active,
    }));
  if (fold > 0) items.unshift({
    tab: 'reports', label: TAB_NAMES.reports, href: tabHref('reports'), current: active === 'reports',
  });

  function follow(event: MouseEvent<HTMLAnchorElement>, tab: DashboardTab) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onTabChange(tab);
  }

  return (
    <nav ref={nav} aria-label={SECTIONS} data-row={SECTIONS} data-row-fold={fold} data-wide-label={moreActive && active !== 'reports' ? '' : undefined} className={styles.root}>
      <div className={styles.probes} aria-hidden="true">
        {[0, 1].map(step => (
          <div key={step} className={styles.probe} data-fit-step={step}>
            {PRIMARY_TABS.filter(tab => step === 0 || tab !== 'reports').map(tab => (
              <span key={tab} className={styles.key} data-label={TAB_NAMES[tab]} />
            ))}
            <span className={styles.key} data-label={active === 'reports' ? (step > 0 ? TAB_NAMES.reports : MORE) : moreLabel} />
          </div>
        ))}
      </div>
      <OneRowScroller label={SECTIONS} previousName={PREVIOUS_SECTIONS} nextName={NEXT_SECTIONS}
        overflow={fold === 2} className={styles.scroller} rowClassName={styles.keys}>
        {PRIMARY_TABS.map(tab => (
          <a key={tab} className={styles.key} data-reports={tab === 'reports' ? '' : undefined}
            aria-label={TAB_NAMES[tab]} aria-current={active === tab ? 'page' : undefined}
            href={tabHref(tab)} onClick={event => follow(event, tab)}>
            <span className={styles.label}>{TAB_NAMES[tab]}</span>
          </a>
        ))}
        <button ref={anchor} type="button" className={styles.key} aria-current={moreActive ? 'page' : undefined}
          aria-label={moreActive ? moreLabel.toUpperCase() : moreLabel}
          aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
          onClick={() => setOpen(value => !value)}
          onKeyDown={event => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            setOpen(true);
          }}>
          <span className={styles.label} data-more-label>{moreLabel}</span>
          <span className={styles.caret} aria-hidden="true" />
        </button>
      </OneRowScroller>
      {open && (
        <MoreMenu id={menuId} items={items} links={PACKAGE_LINKS} firstLine={moreFirstLine}
          headerFold={headerFold} anchor={anchor} onClose={close}
          onChoose={tab => {
            close(true);
            if (tab) onTabChange(tab);
          }} />
      )}
    </nav>
  );
}
