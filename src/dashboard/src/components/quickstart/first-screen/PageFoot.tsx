/**
 * The foot of the Run tab: the adults line again, the site's links in one
 * row, the Analytics choices control and the licence line. It ends the page
 * and scrolls with it. It makes no request of its own.
 *
 * The Analytics choices control is the page's own (#pcc-reopen), which the
 * consent script opens from; the foot holds it while it is mounted, on a
 * server that gives the page the consent bar.
 *
 * @module paracosm/dashboard/quickstart/first-screen/PageFoot
 */
import { hasConsentBar, useConsentControl } from '../../layout/consentControl';
import { FOOT_LINKS, LICENCE_LINE, NOTE_ADULTS, SITE_LINKS } from './words';
import styles from './PageFoot.module.scss';

export function PageFoot() {
  const consentBar = hasConsentBar();
  const slot = useConsentControl();
  return (
    <footer className={styles.foot} role="contentinfo" data-testid="page-foot">
      <p className={styles.adults} data-testid="foot-adults">{NOTE_ADULTS}</p>
      <div className={styles.parts}>
        <nav className={styles.nav} aria-label={SITE_LINKS}>
          <ul className={styles.links} data-row="site links">
            {FOOT_LINKS.map((link) => (
              <li key={link.label}>
                <a className={styles.link} href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        {consentBar && <span ref={slot} className={styles.choices} />}
        <p className={styles.licence} data-testid="foot-licence">{LICENCE_LINE}</p>
      </div>
    </footer>
  );
}
