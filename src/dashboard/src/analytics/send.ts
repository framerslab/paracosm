import { checkedFirstScreenEvent, type FirstScreenEventName } from '../../../analytics/first-screen-events.js';

type Purpose = 'count' | 'measure' | 'record';

interface AnalyticsPage extends Window {
  paracosmConsent?: { allows?: (purpose: Purpose) => unknown };
  gtag?: (...args: unknown[]) => void;
  clarity?: (...args: unknown[]) => void;
}

interface Delivery {
  name: string;
  fields: Record<string, string>;
  count: boolean;
  record: boolean;
  dashboard?: boolean;
}

function allows(page: AnalyticsPage, purpose: Purpose): boolean {
  try {
    return page.paracosmConsent?.allows?.(purpose) === true;
  } catch {
    return false;
  }
}

/** Delivers already checked fields under the site's current consent choices. */
export function deliverEvent(event: Delivery, w?: Window): void {
  const target = w ?? (typeof window === 'undefined' ? undefined : window);
  if (!target) return;
  const page: AnalyticsPage = target;
  const { name, fields, count, record } = event;

  if (count && allows(page, 'count')) {
    try {
      void page.fetch('/api/event', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        keepalive: true,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({ n: name, u: '/sim', p: fields }),
      }).catch(() => {});
    } catch {
      // The site count is optional.
    }
  }

  if (allows(page, 'measure')) {
    try {
      const params = event.dashboard || count ? {
        ...fields,
        page_location: page.location.origin + '/sim',
        page_title: 'Watch AI leaders run the same scenario | Paracosm',
        page_referrer: '',
      } : forgePageContext(page, fields);
      page.gtag?.('event', name, params);
    } catch {
      // A vendor failure leaves the action and other destinations working.
    }
  }

  if (record && allows(page, 'record')) {
    try {
      page.clarity?.('event', name);
    } catch {
      // Recording is optional.
    }
  }
}

function forgePageContext(page: Window, fields: Record<string, string>): Record<string, string> {
  try {
    const { origin, pathname } = page.location;
    if (typeof origin === 'string' && typeof pathname === 'string') {
      return { ...fields, page_location: origin + pathname };
    }
  } catch {
    // Preserve the forge event's fields when the page address is unavailable.
  }
  return fields;
}

/** Validates and sends a first-screen event for each allowed purpose. */
export function sendEvent(name: FirstScreenEventName, fields: Readonly<Record<string, string>>, w?: Window): void {
  const checked = checkedFirstScreenEvent(name, fields);
  if (checked) deliverEvent({ ...checked, dashboard: true }, w);
}
