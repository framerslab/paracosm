/**
 * The saved-run list every picker reads (Quickstart's "Replay last run",
 * Load Prior Run, the Run menu): one shared list, fetched when a picker
 * mounts or opens and again when a run's save lands.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

interface Snapshot { sessions: Array<{ id: string; title?: string }>; status: string }
interface SavedSessions {
  getSnapshot: () => Snapshot;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
}

/** A /sessions endpoint that answers each fetch with the next list, and counts the fetches. */
function endpoint(lists: Array<Array<{ id: string; title?: string }>>) {
  let calls = 0;
  const load = async () => {
    const sessions = lists[Math.min(calls, lists.length - 1)];
    calls += 1;
    return new Response(JSON.stringify({ sessions }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { load, calls: () => calls };
}

test('a save that lands refreshes the one list every mounted picker reads', async () => {
  const mod = await import('./useSessions.js') as unknown as Record<string, unknown>;
  const create = mod.createSavedSessionsStore as ((load: () => Promise<Response>) => SavedSessions) | undefined;
  const onSimSaved = mod.refreshOnSimSaved as ((store: SavedSessions, data: unknown) => Promise<void>) | undefined;
  assert.equal(typeof create, 'function', 'the module makes a shared saved-run list');
  assert.equal(typeof onSimSaved, 'function', 'and refreshes it on a sim_saved event');

  const server = endpoint([[{ id: 'older' }], [{ id: 'new' }, { id: 'older' }], [{ id: 'new', title: 'A titled run' }, { id: 'older' }]]);
  const store = create!(server.load);
  const seen = { quickstart: 0, runMenu: 0 };
  const stopQuickstart = store.subscribe(() => { seen.quickstart += 1; });
  const stopRunMenu = store.subscribe(() => { seen.runMenu += 1; });

  // A picker mounting fetches the list.
  await store.refresh();
  assert.deepEqual(store.getSnapshot().sessions.map(s => s.id), ['older']);
  assert.equal(store.getSnapshot().status, 'ready');

  // A skipped save changes nothing and fetches nothing.
  await onSimSaved!(store, { status: 'skipped', reason: 'partial_completion' });
  assert.equal(server.calls(), 1);

  const before = { ...seen };
  await onSimSaved!(store, { status: 'saved', id: 'new' });
  assert.equal(server.calls(), 2);
  assert.deepEqual(store.getSnapshot().sessions.map(s => s.id), ['new', 'older'], 'the new run is listed without a reload');
  assert.ok(seen.quickstart > before.quickstart && seen.runMenu > before.runMenu, 'every mounted picker hears of it');

  // The title lands later, and the list shows it.
  await onSimSaved!(store, { status: 'titled', id: 'new', title: 'A titled run' });
  assert.equal(store.getSnapshot().sessions[0].title, 'A titled run');

  stopQuickstart();
  stopRunMenu();
});
