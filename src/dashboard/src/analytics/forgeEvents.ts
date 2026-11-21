/**
 * The forge view's events: what a visitor opens and does in the forged tool
 * view, sent only under the visitor's yes.
 *
 * The consent script of the hosted demo (assets/consent/consent.js) answers
 * `window.paracosmConsent.allows(purpose)` for the purposes of its bar. An
 * event goes to Google Analytics (`gtag('event', name, fields)`) while the
 * measure purpose has a yes, and to Microsoft Clarity
 * (`clarity('event', name)`, its name alone) while the record purpose has
 * one. The count purpose takes page views alone, so no event goes to
 * Plausible. A page with no consent script, a purpose with no yes, or a
 * vendor whose function is not on the page sends nothing.
 *
 * Each event carries only the fields its type names, each one of a fixed
 * list of values: no tool name, actor name, trace content or free text
 * reaches a vendor, even from a caller that passes more.
 */
import { STATIONS, type StationId } from '../components/forge/forgeLine';

/** Where the forged toolbox was opened: the Sim footer, Reports' page, or the Viz tab's FORGE mode. */
export type ToolboxOpenFrom = 'sim' | 'reports' | 'viz';

/** Where a tool's trace was opened: a toolbox row, a run view INSPECT key, a Viz forge mark, or a link. */
export type TraceOpenFrom = 'toolbox' | 'inspect' | 'viz' | 'link';

/** How many actors the actor picker chose, in the ranges the events report. */
export type ActorRange = '1' | '2-4' | '5-24' | '25+';

export type ForgeEvent =
  | { name: 'forge_toolbox_open'; from: ToolboxOpenFrom }
  | { name: 'forge_trace_open'; from: TraceOpenFrom }
  | { name: 'forge_station_open'; station: StationId; via: 'press' | 'open_all' | 'kept' }
  | { name: 'forge_toolbox_filter'; show: 'all' | 'passed' | 'did_not_pass' }
  | { name: 'forge_record_export'; what: 'toolbox' | 'record_copy' | 'record_download' }
  | { name: 'forge_log_jump' } | { name: 'forge_link_copy' }
  | { name: 'forge_toolbox_group'; group: 'actor' | 'department' | 'none' }
  | { name: 'forge_group_toggle'; scope: 'one' | 'all' }
  | { name: 'forge_actor_filter'; actors: ActorRange }
  | { name: 'forge_actor_picker_open'; where: 'toolbox' | 'compare' | 'event_log' };

/** Each event's fields and the values each may hold. Nothing else is sent. */
const FIELDS: Record<ForgeEvent['name'], Record<string, readonly string[]>> = {
  forge_toolbox_open: { from: ['sim', 'reports', 'viz'] },
  forge_trace_open: { from: ['toolbox', 'inspect', 'viz', 'link'] },
  forge_station_open: { station: STATIONS, via: ['press', 'open_all', 'kept'] },
  forge_toolbox_filter: { show: ['all', 'passed', 'did_not_pass'] },
  forge_record_export: { what: ['toolbox', 'record_copy', 'record_download'] },
  forge_log_jump: {},
  forge_link_copy: {},
  forge_toolbox_group: { group: ['actor', 'department', 'none'] },
  forge_group_toggle: { scope: ['one', 'all'] },
  forge_actor_filter: { actors: ['1', '2-4', '5-24', '25+'] },
  forge_actor_picker_open: { where: ['toolbox', 'compare', 'event_log'] },
};

/** The range a number of chosen actors falls in; null for none, which is every actor and no filter. */
export function actorRange(chosen: number): ActorRange | null {
  if (!Number.isFinite(chosen) || chosen < 1) return null;
  if (chosen === 1) return '1';
  if (chosen <= 4) return '2-4';
  if (chosen <= 24) return '5-24';
  return '25+';
}

/** What the consent script and the two vendors put on the page. */
interface AnalyticsPage {
  paracosmConsent?: { allows?: (purpose: string) => unknown };
  gtag?: (...args: unknown[]) => void;
  clarity?: (...args: unknown[]) => void;
}

/** Whether the visitor said yes to a purpose; no on a page with no consent script or an answer it cannot read. */
function allows(page: AnalyticsPage, purpose: 'measure' | 'record'): boolean {
  try {
    const consent = page.paracosmConsent;
    return typeof consent?.allows === 'function' && consent.allows(purpose) === true;
  } catch {
    return false;
  }
}

/** The page's address with no query or fragment, or null where the page has none to read. */
function pageLocation(w: Window): string | null {
  try {
    const { origin, pathname } = w.location;
    return typeof origin === 'string' && typeof pathname === 'string' ? origin + pathname : null;
  } catch {
    return null;
  }
}

/**
 * Sends one forge view event to the vendors whose purpose has the visitor's
 * yes. It never throws: an analytics failure leaves the page as it was.
 */
export function sendForgeEvent(event: ForgeEvent, w?: Window): void {
  const target = w ?? (typeof window === 'undefined' ? undefined : window);
  if (!target) return;
  const page = target as unknown as AnalyticsPage;
  const fields = FIELDS[event.name];
  if (!fields) return;
  const measure = allows(page, 'measure');
  const record = allows(page, 'record');
  if (!measure && !record) return;

  const sent: Record<string, string> = {};
  const given = event as unknown as Record<string, unknown>;
  for (const [field, values] of Object.entries(fields)) {
    const value = given[field];
    // A value off its list is a caller's mistake; the event goes without it rather than with words it should not carry.
    if (typeof value === 'string' && values.includes(value)) sent[field] = value;
  }

  if (measure && typeof page.gtag === 'function') {
    // Google's tag sends the page's address with every event unless the event
    // names one, and the address can hold a search typed into Find a tool:
    // the event names the page by its address with no query, as the page
    // view does.
    const where = pageLocation(target);
    try {
      page.gtag('event', event.name, where === null ? sent : { ...sent, page_location: where });
    } catch {
      // Google's tag refused the event; the page carries on.
    }
  }
  if (record && typeof page.clarity === 'function') {
    try {
      page.clarity('event', event.name);
    } catch {
      // Clarity refused the event; the page carries on.
    }
  }
}
