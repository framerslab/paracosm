/** Fixed analytics fields shared by the dashboard and count endpoint. */
function rule(record: boolean, fields: Record<string, readonly string[]>, count = true) {
  for (const values of Object.values(fields)) Object.freeze(values);
  return Object.freeze({ record, count, fields: Object.freeze(fields) });
}

const EVENTS = Object.freeze({
  qs_view: rule(true, {
    state: ['ready', 'no_run_left'],
    entry: ['direct', 'from_landing', 'from_tab'],
  }),
  qs_start: rule(true, {
    picked: ['yes', 'no'],
    key: ['host', 'own', 'server'],
    size: ['2', '3_8', '9_24', '25_100', '101_300'],
  }),
  run_started: rule(true, { key: ['host', 'own'] }),
  run_failed: rule(true, { reason: ['no_run_left', 'capacity', 'network', 'key_refused', 'other'] }),
  qs_how_open: rule(false, {}),
  qs_no_run_left_view: rule(true, {}),
  qs_no_run_left_action: rule(true, { action: ['replay_last', 'add_key'] }),
  qs_pair_switch: rule(false, { to: ['1', '2'] }),
  qs_prompt_open: rule(true, { side: ['left', 'right'] }),
  watch_play: rule(false, { key: ['back', 'play', 'pause', 'forward', 'latest', 'speed_half', 'speed_1', 'speed_2', 'speed_4'] }, false),
  watch_turn_pick: rule(false, {}, false),
  watch_fold: rule(false, { fold: ['crisis', 'reasoning'] }, false),
  tab_change: rule(false, { to: ['quickstart', 'sim', 'reports', 'studio', 'viz', 'chat', 'library', 'settings', 'about'] }),
});

/** A named first-screen or dashboard frame event. */
export type FirstScreenEventName = keyof typeof EVENTS;

function isEventName(name: unknown): name is FirstScreenEventName {
  return typeof name === 'string' && Object.hasOwn(EVENTS, name);
}

/** Accepts exactly the listed fields and copies their fixed string values. */
export function checkedFirstScreenEvent(name: unknown, fields: unknown): {
  name: FirstScreenEventName;
  fields: Record<string, string>;
  record: boolean;
  count: boolean;
} | null {
  if (!isEventName(name) || typeof fields !== 'object' || fields === null || Array.isArray(fields)) return null;
  const prototype = Object.getPrototypeOf(fields);
  if (prototype !== Object.prototype && prototype !== null) return null;

  const rule = EVENTS[name];
  const entries = Object.entries(rule.fields);
  if (Reflect.ownKeys(fields).length !== entries.length) return null;

  const checked: Record<string, string> = {};
  for (const [key, allowed] of entries) {
    const value: unknown = Object.getOwnPropertyDescriptor(fields, key)?.value;
    if (typeof value !== 'string' || !allowed.includes(value)) return null;
    checked[key] = value;
  }
  return { name, fields: checked, record: rule.record, count: rule.count };
}

/** Maps a whole leader count to its analytics bucket. */
export function sizeBucket(size: number): '2' | '3_8' | '9_24' | '25_100' | '101_300' | null {
  if (!Number.isInteger(size) || size < 2 || size > 300) return null;
  if (size === 2) return '2';
  if (size <= 8) return '3_8';
  if (size <= 24) return '9_24';
  if (size <= 100) return '25_100';
  return '101_300';
}
