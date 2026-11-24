import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { DashboardTab } from '../../tab-routing';
import { SECTIONS } from './frameWords';
import styles from './MoreMenu.module.scss';

/** One entry of the More menu: a tab of the dashboard, or a link out of it. */
export interface SectionMenuItem {
  tab?: DashboardTab;
  label: string;
  description?: string;
  href: string;
  external?: boolean;
  current?: boolean;
}

interface MoreMenuProps {
  id: string;
  items: SectionMenuItem[];
  links: SectionMenuItem[];
  firstLine: string | null;
  headerFold: number;
  onChoose: (tab?: DashboardTab) => void;
  onClose: (restoreFocus: boolean) => void;
  anchor: RefObject<HTMLButtonElement | null>;
}

/**
 * The menu the More key opens, drawn in a layer over the page and placed
 * under its key, which it follows as the row resizes or scrolls. It opens
 * with focus on its first item; the arrow keys, Home and End move between
 * items; Escape and Tab close it with focus back on More, and a press
 * outside closes it. `items` are the tabs the header row does not show at
 * its fold, `links` the package's links below a rule.
 */
export function MoreMenu({ id, items, links, firstLine, headerFold, onChoose, onClose, anchor }: MoreMenuProps) {
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const menu = panel.current;
    const key = anchor.current;
    if (!menu || !key) return;
    const position = () => {
      const bounds = key.getBoundingClientRect();
      menu.style.setProperty('--more-anchor-left', bounds.left + 'px');
      menu.style.setProperty('--more-anchor-bottom', bounds.bottom + 'px');
    };
    position();
    const sizes = new ResizeObserver(position);
    sizes.observe(key);
    const banner = key.closest('header');
    if (banner) sizes.observe(banner);
    window.addEventListener('resize', position);
    // A wheel, a swipe or a trackpad can scroll the row that holds More, or
    // any box around it, without a press on the menu's key.
    window.addEventListener('scroll', position, true);
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      sizes.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [anchor]);

  useEffect(() => {
    const phone = window.matchMedia('(width < 600px)');
    const onResize = () => onClose(true);
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!panel.current?.contains(event.target) && !anchor.current?.contains(event.target)) onClose(false);
    };
    phone.addEventListener('change', onResize);
    document.addEventListener('pointerdown', outside);
    return () => {
      phone.removeEventListener('change', onResize);
      document.removeEventListener('pointerdown', outside);
    };
  }, [anchor, onClose]);

  function move(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      onClose(true);
      return;
    }
    const keys = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const current = keys.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = (current + 1) % keys.length; break;
      case 'ArrowUp': next = (current + keys.length - 1) % keys.length; break;
      case 'Home': next = 0; break;
      case 'End': next = keys.length - 1; break;
      default: return;
    }
    event.preventDefault();
    keys[next]?.focus();
  }

  function renderItem(item: SectionMenuItem) {
    return (
      <a
        key={item.href}
        className={styles.item}
        data-row={item.label}
        role="menuitem"
        tabIndex={-1}
        aria-current={item.current ? 'page' : undefined}
        href={item.href}
        target={item.external ? '_blank' : undefined}
        rel={item.external ? 'noopener noreferrer' : undefined}
        onClick={event => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (item.tab) event.preventDefault();
          onChoose(item.tab);
        }}
        onKeyDown={event => {
          if (event.key === ' ') {
            event.preventDefault();
            event.currentTarget.click();
          }
        }}
      >
        <span className={styles.name}>{item.label}</span>
        {item.description && <span className={styles.description}>{item.description}</span>}
      </a>
    );
  }

  return createPortal(
    <div ref={panel} id={id} role="menu" aria-label={SECTIONS} data-header-fold={headerFold}
      className={styles.menu} onKeyDown={move}>
      {firstLine && <p className={styles.line}>{firstLine}</p>}
      {items.map(renderItem)}
      <div className={styles.rule} role="separator" aria-orientation="horizontal" />
      {links.map(renderItem)}
    </div>,
    document.body,
  );
}
