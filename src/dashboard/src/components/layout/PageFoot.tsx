import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { hasConsentBar, useConsentControl } from './useConsentControl';
import { useRowFit } from './useRowFit';
import { OneRowScroller } from '../shared/OneRowScroller';
import { NOTE_ADULTS } from '../quickstart/first-screen/words';
import { FOOT_LINKS, LICENCE_LINE, MORE_LINKS, SITE_LINKS } from './frameWords';
import styles from './PageFoot.module.scss';

type FootLink = (typeof FOOT_LINKS)[number];

/** The links More links holds when the row is folded: every one but the last. */
const FOLDED = FOOT_LINKS.slice(0, -1);
/** The links the folded row keeps beside More links. */
const KEPT = FOOT_LINKS.slice(-1);

/**
 * The More links key and its menu: a press opens the menu with focus on its
 * first link; the arrow keys, Home and End move between the links; Escape
 * closes it with focus back on the key; Tab or a press outside closes it.
 */
function MoreLinks({ links, menuSlot }: { links: readonly FootLink[]; menuSlot?: HTMLElement | null }) {
  const [open, setOpen] = useState(false);
  const key = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLUListElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (menu.current?.contains(target) || key.current?.contains(target))) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const onMenuKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown': move(at + 1); break;
      case 'ArrowUp': move(at - 1); break;
      case 'Home': move(0); break;
      case 'End': move(items.length - 1); break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        key.current?.focus();
        break;
      case 'Tab': setOpen(false); break;
      default: break;
    }
  };

  const menuList = open && (
    <ul ref={menu} id={id} role="menu" aria-label={MORE_LINKS} className={styles.menu} onKeyDown={onMenuKey}>
      {links.map((link) => (
        <li key={link.label} role="none">
          <a role="menuitem" className={styles.menuItem} href={link.href} {...externalLink(link)} onClick={() => setOpen(false)}>
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
  return (
    <div className={styles.more}>
      <button
        ref={key}
        type="button"
        className={styles.moreKey}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        {MORE_LINKS}
      </button>
      {menuSlot && menuList ? createPortal(menuList, menuSlot) : menuList}
    </div>
  );
}

function externalLink(link: FootLink) {
  return link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

/** The links, notices and consent control at the end of every tab. */
export function PageFoot() {
  const consentBar = hasConsentBar();
  const slot = useConsentControl();
  const nav = useRef<HTMLElement | null>(null);
  const fold = useRowFit(nav, 2);
  const links = (fold ? KEPT : FOOT_LINKS).map(link => (
    <a key={link.label} className={styles.link} href={link.href} {...externalLink(link)}>{link.label}</a>
  ));

  return (
    <footer className={styles.foot} role="contentinfo" data-testid="page-foot">
      <p className={styles.adults} data-testid="foot-adults" data-text="body">{NOTE_ADULTS}</p>
      <div className={styles.parts}>
        <nav ref={nav} className={styles.nav} aria-label={SITE_LINKS} data-row="site links">
          {fold === 2 ? (
            <OneRowScroller label="site links" rowClassName={styles.links}>
              {links}
              <MoreLinks links={FOLDED} menuSlot={nav.current} />
            </OneRowScroller>
          ) : (
            <div className={styles.links}>
              {links}
              {fold === 1 && <MoreLinks links={FOLDED} />}
            </div>
          )}
          <div className={styles.measure} aria-hidden="true">
            <div className={`${styles.links} ${styles.fullRow}`} data-fit-step="0">
              {FOOT_LINKS.map(link => <span key={link.label} className={styles.link}>{link.label}</span>)}
            </div>
            <div className={`${styles.links} ${styles.fullRow}`} data-fit-step="1">
              {KEPT.map(link => <span key={link.label} className={styles.link}>{link.label}</span>)}
              <span className={styles.moreKey}>{MORE_LINKS}</span>
            </div>
          </div>
        </nav>
        {consentBar && <span ref={slot} className={styles.choices} />}
        <p className={styles.licence} data-testid="foot-licence">{LICENCE_LINE}</p>
      </div>
    </footer>
  );
}
