/**
 * The foot of the Run tab: the adults line again, the site's links in one
 * row, the Analytics choices control and the licence line. It ends the page
 * and scrolls with it. It makes no request of its own.
 *
 * The links stay one row. When the four do not fit the room the foot has
 * (200 per cent text in a phone's column), Docs, GitHub and npm move under a
 * More links key, which opens them as a menu, and the row holds Privacy and
 * that key. A hidden copy of the full row, drawn at the links' own size,
 * says whether they fit.
 *
 * The Analytics choices control is the page's own (#pcc-reopen), which the
 * consent script opens from; the foot holds it while it is mounted, on a
 * server that gives the page the consent bar.
 *
 * @module paracosm/dashboard/quickstart/first-screen/PageFoot
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { hasConsentBar, useConsentControl } from '../../layout/consentControl';
import { FOOT_LINKS, LICENCE_LINE, MORE_LINKS, NOTE_ADULTS, SITE_LINKS } from './words';
import styles from './PageFoot.module.scss';

type FootLink = (typeof FOOT_LINKS)[number];

/** The links More links holds when the row is folded: every one but the last. */
const FOLDED = FOOT_LINKS.slice(0, -1);
/** The links the folded row keeps beside More links. */
const KEPT = FOOT_LINKS.slice(-1);

/**
 * Whether the full row of links is wider than the room the navigation has.
 * Read again whenever either changes size, so a larger text size folds the
 * row and a wider window unfolds it.
 */
function useFolded(nav: RefObject<HTMLElement | null>, full: RefObject<HTMLElement | null>): boolean {
  const [folded, setFolded] = useState(false);
  useLayoutEffect(() => {
    const navEl = nav.current;
    const fullEl = full.current;
    if (!navEl || !fullEl) return undefined;
    const read = () => setFolded(fullEl.getBoundingClientRect().width > navEl.clientWidth + 0.5);
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const sizes = new ResizeObserver(read);
    sizes.observe(navEl);
    sizes.observe(fullEl);
    return () => sizes.disconnect();
  }, [nav, full]);
  return folded;
}

/**
 * The More links key and its menu: a press opens the menu with focus on its
 * first link; the arrow keys, Home and End move between the links; Escape
 * closes it with focus back on the key; Tab or a press outside closes it.
 */
function MoreLinks({ links }: { links: readonly FootLink[] }) {
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

  return (
    <li className={styles.more}>
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
      {open && (
        <ul ref={menu} id={id} role="menu" aria-label={MORE_LINKS} className={styles.menu} onKeyDown={onMenuKey}>
          {links.map((link) => (
            <li key={link.label} role="none">
              <a role="menuitem" className={styles.menuItem} href={link.href} onClick={() => setOpen(false)}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function PageFoot() {
  const consentBar = hasConsentBar();
  const slot = useConsentControl();
  const nav = useRef<HTMLElement | null>(null);
  const full = useRef<HTMLUListElement | null>(null);
  const folded = useFolded(nav, full);
  const shown: readonly FootLink[] = folded ? KEPT : FOOT_LINKS;
  return (
    <footer className={styles.foot} role="contentinfo" data-testid="page-foot">
      <p className={styles.adults} data-testid="foot-adults">{NOTE_ADULTS}</p>
      <div className={styles.parts}>
        <nav ref={nav} className={styles.nav} aria-label={SITE_LINKS}>
          <ul className={styles.links} data-row="site links">
            {shown.map((link) => (
              <li key={link.label}>
                <a className={styles.link} href={link.href}>{link.label}</a>
              </li>
            ))}
            {folded && <MoreLinks links={FOLDED} />}
          </ul>
          {/* The full row at the links' own size, unseen and clipped to nothing, read by useFolded. */}
          <div className={styles.measure} aria-hidden="true">
            <ul ref={full} className={`${styles.links} ${styles.fullRow}`}>
              {FOOT_LINKS.map((link) => (
                <li key={link.label}><span className={styles.link}>{link.label}</span></li>
              ))}
            </ul>
          </div>
        </nav>
        {consentBar && <span ref={slot} className={styles.choices} />}
        <p className={styles.licence} data-testid="foot-licence">{LICENCE_LINE}</p>
      </div>
    </footer>
  );
}
