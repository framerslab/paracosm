# Paracosm HTTP API Reference

The dashboard server (`paracosm dashboard`) exposes a versioned HTTP surface under `/api/v1/*`. The same routes power the React dashboard and any external client. This page documents every endpoint, its request shape, response shape, and status codes.

Source of truth: [`src/server/routes/platform-api.ts`](../src/server/routes/platform-api.ts), [`src/server/routes/public-demo.ts`](../src/server/routes/public-demo.ts), [`src/server/routes/bundle.ts`](../src/server/routes/bundle.ts), and [`src/server/routes/library-import.ts`](../src/server/routes/library-import.ts); `POST /scenario/store`, a dashboard route outside `/api/v1`, is in [`src/server/server-app.ts`](../src/server/server-app.ts).

For the SDK (`WorldModel.simulate()`, `WorldModel.batch()`, `WorldModel.intervene()`, etc.) see the [Cookbook](./COOKBOOK.md). This page is the wire-level reference for the HTTP surface only.

## Base URL and gating

- Local: `http://localhost:3456` (override with `PORT`, set in the environment or in a `.env` file in the directory you start the server from)
- All `/api/v1/runs*` and `/api/v1/bundles/*` routes return **403 `run_history_routes_disabled`** when the server is started with `PARACOSM_ENABLE_RUN_HISTORY_ROUTES=false`. Default is `true` except in `hosted_demo` mode.
- Routes are CORS-permissive (`Access-Control-Allow-Origin: *`) for local dashboard development.
- A local server (neither `PARACOSM_HOSTED_DEMO` nor `PARACOSM_PLATFORM_API` set) answers **403 `cross_site_refused`** to any request, the CORS preflight included, sent to a name it does not answer: its `Host` must be a loopback name (`localhost`, `127.0.0.1`, `[::1]`), an IP address, the name `HOST` gives or a name `PARACOSM_ALLOWED_HOSTS` lists (an internationalized name in its ASCII form, `xn--...`), on any port, whatever `Origin` says. It also answers 403 to any request but the preflight whose `Origin` is not a loopback address (any port) or the host the request was sent to, `Origin: null` included. Requests with no `Origin` (same-origin reads, curl, scripts) to such a name pass.
- `paracosm dashboard` listens on `127.0.0.1` on a local server; set `HOST` (for example `HOST=0.0.0.0` in a container or for a LAN demo) to listen elsewhere. The hosted demo and the platform API mode listen on every interface unless `HOST` is set. To reach a local server by a name while it listens on an address, list the name in `PARACOSM_ALLOWED_HOSTS` (empty by default; comma-separated names, no port). Behind a proxy, also have the proxy pass the browser's `Host` header unchanged, name and port (nginx: `proxy_set_header Host $http_host;`); a `Host` without the page's port works only for a page on its scheme's default port.
- On the hosted demo, every model call a request makes runs on the caller's own provider key when the request brings one (`apiKey` for OpenAI, `anthropicKey` for Anthropic in a body; `X-API-Key` and `X-Anthropic-Key` on `/simulate`), on the provider that key belongs to (with both keys, on the `provider` the request names; `compile-from-seed`, `generate-actors` and `simulate-intervention` take no `provider` and run such a request on OpenAI). A request with no key of its own runs on the host's keys, always on OpenAI, whatever `provider` it names. No call of either kind falls back to another provider or to another provider's key. A key the server reads as no key (blank, or a masked value such as `sk-...`) is no key, and the dashboard's Settings reads it the same way: such a value leaves its provider and model choices locked and is not posted. This holds for a `/setup` run (its commander, departments, director, reactions, tool review and verdict, and the title of its saved session), `/simulate`, `/compile`, `/chat`, `compile-from-seed` (its draft and its compile), `generate-actors` and `simulate-intervention`. A host-paid `/setup`, `/simulate` or `simulate-intervention` runs on the demo's OpenAI models (the set `applyDemoCaps` gives a `/setup`), whatever `models` or `costPreset` the request names; a host-paid `/compile` compiles on `gpt-5.4-nano`; a host-paid draft and actor call run on `gpt-5.4-mini`. When the host holds no OpenAI key (`OPENAI_API_KEY`), whatever other key it holds, each of these requests with no key of its own answers **503** with the reason, before any of the day's limits counts it and, for `simulate-intervention`, before its world is prepared. A `simulate-intervention` that names no `scenarioId` runs in the Digital Twin's world, which the server compiles from `scenarios/t2d-glp1-protocol.json` and keeps: a kept world is served to every caller, and serving it makes no model call. A request that finds no kept world compiles it as one more of its model calls: on the caller's own key and that key's provider (`gpt-5.4-mini` on OpenAI, `claude-sonnet-4-6` on Anthropic), else on the host's OpenAI key on `gpt-5.4-mini`, with no fallback to another provider. A compile in flight serves only the requests the same key pays for; a request another key pays for compiles on its own key. A compile that fails is not kept: its request answers **503**, or runs in the world another request's compile has left meanwhile, and the next request compiles again. At most 4 compiles of the world run at once, whoever pays: a request past them starts none, waits for them to end and runs in the world they leave, or answers **503** when they leave none. A request that compiles the world, or waits for a compile, answers after that compile and its own run; behind a gateway with a response deadline such a request can be cut, and then the compile goes on, the world it leaves is kept, and the next request runs in it at once. When the hosted server starts it compiles the world on the host's OpenAI key; a host with no OpenAI key compiles nothing at its start and logs one line saying so. A `/chat` with no key of its own on a run started with the caller's own key (a `/setup` run or a Digital Twin run) runs on that run's key and provider; a `/chat` with no key of its own on a host-paid run is host-paid; a `/chat` that brings a key runs on that key, whoever paid for the run. When a finished run is saved, its title comes from one model call, made with the run's own key when the run had one. A local server and the npm package's dashboard keep the routing a request and the environment give them: there the Digital Twin's world is compiled on the server's keys, at its start or for the first request that finds none, whatever key a request brings.
- On the hosted demo, a `POST /simulate` (where enabled) that names `options.seedUrl` answers **400** (send the seed as `options.seedText`), before the day's run limit counts it, and the compile behind every `/simulate` runs without web search: the host's scraping and search keys would read the seed, and the request's model keys do not pay for them. A Quickstart request on the caller's own key takes none of the host's limits on `generate-actors` and `simulate-intervention` (the Quickstart and run limits of the day, the two-leader cap, the turn cap): `generate-actors` writes the 2 to 300 leaders its `count` asks for. A host-paid `generate-actors` writes at most 2 leaders and a host-paid `simulate-intervention` runs at most the demo's turns, with the daily limiter on or off. A `compile-from-seed` counts against the day's compiles whoever pays for its model, since its research reads the web on the host's search keys.
- On the hosted demo, a `POST` from a page on another site answers **403 `cross_site_refused`** on `/setup`, `/chat` and `/simulate` (where enabled) without the caller's own provider key; on `/compile` without one or with a `seedText` or `seedUrl` the host's search or scraping keys would read; and on every `/api/quickstart/*` route and `/scenario/switch` always. An `Origin` that `PARACOSM_ALLOWED_ORIGINS` lists counts as the demo's own first; when it lists origins, a request whose `Origin` is any other origin (not `null`) is another site's, whatever `Sec-Fetch-Site` says. Otherwise `Sec-Fetch-Site: cross-site` or `same-site` names another site, and `same-origin` or `none` passes. With no known `Sec-Fetch-Site`, `Origin` must be absent or an HTTP(S) URL whose host and port match `Host`; `Origin: null` is refused. Requests with neither header (curl, scripts) are answered as before. `PARACOSM_ALLOWED_ORIGINS` is hosted-demo-only and empty by default: comma-separated origins (`https://host` or `https://host:port`, also `http:`), with no path, trailing slash, user part or explicit default port, an internationalized name in its ASCII form (`xn--...`). Invalid entries are dropped. The deploy lists the demo's own public origin so its pages pass even when a proxy rewrites `Host`.
- In `platform_api` mode every `/api/v1/*` route except `GET /api/v1/demo/status` takes the admin credential, however the request target that names it is written: `ADMIN_WRITE=true`, `ADMIN_TOKEN` set, and a matching `X-Admin-Token` header (403 without `ADMIN_WRITE`, 503 without `ADMIN_TOKEN`, 401 without a matching header).

## Run history in `hosted_demo` mode

In `hosted_demo` mode the run-history routes are off unless `PARACOSM_ENABLE_RUN_HISTORY_ROUTES=true` turns them on. With them on, each visitor reaches their own runs:

- A run is recorded for the visitor who started or imported it. The visitor is the one the `paracosm_visitor` cookie names, the same visitor `GET /sessions` lists saved sessions for. The store keeps a SHA-256 of the visitor id with the run, never the cookie value, and no answer holds it.
- `GET /api/v1/runs` and `GET /api/v1/runs/aggregate` hold the caller's runs alone; `total`, `hasMore` and every filter work inside them.
- `GET`, `HEAD`, `/swarm`, `/replay` and `/replay-result` for a run another visitor holds answer exactly as they do for a run id no run has (`404`).
- `GET /api/v1/bundles/:bundleId` and its `/aggregate` answer with the caller's members of the bundle. A bundle with none of them answers `404`, as a bundle no run is in does.
- `POST /api/v1/library/import` stores a run as the caller's. A caller that sent no cookie gets a `paracosm_visitor` cookie with the answer. Each import is stored under a run id of the caller's own, made from the caller and the artifact's `metadata.runId`, and the stored copy carries that id in its `metadata.runId`; the response's `runId` is the id to read it by. The same artifact imported twice by one visitor is one run (`alreadyExisted: true` the second time). An artifact whose run id is one of the caller's own runs answers `alreadyExisted: true` with that id. An artifact whose run id another visitor's run holds is imported as any other is. `addToBundle` puts the caller's runs under that bundle id; each visitor reads their own runs in it.
- A caller that sent no cookie lists no run and reads none.
- A request that carries the admin credential (`ADMIN_WRITE=true`, `ADMIN_TOKEN` set, and a matching `X-Admin-Token` header) reaches every run, and its imports keep the run id their artifact carries.
- A run recorded with no visitor, which is every run recorded before runs had owners, is reached with the admin credential alone.
- Every answer of these routes carries `Cache-Control: no-store` and `Vary: Cookie`.

A local server and `platform_api` mode answer every caller that reaches the routes with every run.

## Endpoint index

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/v1/runs` | List runs with filters and pagination |
| GET    | `/api/v1/runs/aggregate` | Rollup stats for the filtered set |
| GET    | `/api/v1/runs/:runId` | Run record + full RunArtifact JSON |
| GET    | `/api/v1/runs/:runId/swarm` | Final agent-swarm snapshot (lightweight) |
| POST   | `/api/v1/runs/:runId/replay` | Re-run each between-turn step of the stored artifact and check the state saved after it |
| POST   | `/api/v1/runs/:runId/replay-result` | Record a client-side replay outcome |
| GET    | `/api/v1/bundles/:bundleId` | Bundle metadata + member RunRecords |
| GET    | `/api/v1/bundles/:bundleId/aggregate` | Bundle-scoped rollup |
| POST   | `/api/v1/library/import` | Import an externally-produced RunArtifact |
| GET    | `/api/v1/demo/status` | Public-demo capability flags (always reachable) |
| POST   | `/scenario/store` | Store a scenario in this visitor's memory; with `saveToDisk`, write it to the scenarios folder and the shared catalog instead (admin credential) |
| POST   | `/compile` | Compile a scenario JSON into the shared catalog under an id that names nothing yet |
| POST   | `/api/event` | Hosted demo only: one page view from the consent bar, forwarded as the public page it names to the site's Plausible count |

---

## `GET /api/v1/runs`

List runs newest-first with optional filters.

**Query parameters**

| Param | Type | Notes |
|-------|------|-------|
| `mode` | `turn-loop` \| `batch-trajectory` \| `batch-point` | Filter by simulation mode |
| `sourceMode` | `local` \| `hosted_demo` \| `platform_api` | Server mode that produced the run |
| `scenario` | string | Filter by `scenarioId` |
| `leader` | string | Filter by `actorConfigHash` |
| `bundleId` | string | Scope to one Quickstart submission |
| `q` | string | Full-text match on actor name and scenario id |
| `limit` | number | Default 50, clamped to `[1, 500]` |
| `offset` | number | Default 0, clamped to `[0, ∞)` |

**200 response**

```json
{
  "runs": [
    {
      "runId": "run_a1b2c3d4-...",
      "createdAt": "2026-04-30T12:34:56.789Z",
      "scenarioId": "mars-genesis",
      "scenarioVersion": "1.2.0",
      "actorConfigHash": "leaders:9f2c...",
      "economicsProfile": "standard",
      "sourceMode": "local",
      "createdBy": "anonymous",
      "costUSD": 0.34,
      "durationMs": 217000,
      "mode": "turn-loop",
      "actorName": "Maya Patel",
      "actorArchetype": "industrialist",
      "bundleId": "8b1e...",
      "summaryTrajectory": [0.42, 0.46, 0.51, 0.48, 0.44, 0.39, 0.36, 0.33]
    }
  ],
  "total": 132,
  "hasMore": true
}
```

Note: `artifactPath` is stripped from the public projection of every record, including bundle members. Artifacts in run answers, `/simulate`, `/api/quickstart/simulate-intervention`, `/results` and SSE `result` frames (including saved-session and held-run replay) omit `scenarioExtensions.outputPath`. Use `GET /api/v1/runs/:runId` to load the artifact JSON.

## `GET /api/v1/runs/aggregate`

Rollup counters across the filtered set.

**Query parameters:** `mode`, `sourceMode`, `scenario`, `leader` (same semantics as `/runs`).

**200 response**

```json
{
  "totalRuns": 132,
  "totalCostUSD": 47.62,
  "totalDurationMs": 28800000,
  "replaysAttempted": 18,
  "replaysMatched": 17
}
```

## `GET /api/v1/runs/:runId`

Single run record plus the full RunArtifact loaded from disk.

**200 response**

```json
{
  "record": {
    "runId": "run_a1b2...",
    "sessionId": "<uuid>",
    "...": "all fields from /runs response"
  },
  "artifact": { "metadata": { "...": "..." }, "trajectory": { "...": "..." } }
}
```

`sessionId` is the session-store id the run's events were saved under. Populated for runs whose broadcast `autoSaveOnComplete` pass succeeded and whose saved session the store still holds; omitted on legacy rows (runs persisted before the link wire-up), runs whose save was skipped (`below_min_turns` / `partial_completion`), runs whose saved session the store has since evicted, every run while the session store cannot be read, and runs persisted by code paths that bypass the broadcast handler (CLI batch runs, replay-only flows). Consumers can build a deep link to the live SSE replay endpoint with `https://<host>/sim?replay=<sessionId>&tab=viz` when this field is set.

**Status codes**

- `404 not_found` — `runId` not in the run-history store
- `410 artifact_unavailable` — record exists but `artifactPath` was never preserved (legacy run)
- `410 artifact_unreadable` — file was preserved but is missing or unreadable on disk
- `410 artifact_outside_runs_dir` — the record's artifact path resolves outside the server's runs directory (`PARACOSM_OUTPUT_DIR`, else `<cwd>/output`, links resolved); the file is not read. A record imported before imports wrote their own copy can carry such a path.

The runs directory is resolved from the environment the server was started with. The server's own runs (`/setup` and `/simulate`) write their output files there, as imports do, so every record the server stores points into it. A digital-twin run through `/api/quickstart/simulate-intervention` returns its artifact without writing an output file. Like any run, its stream frames are held in `<APP_DIR>/.live-runs/<key>.json` until the run is dropped. Those frames do not include the subject.

The server resolves the path, opens the resolved file once without following a link at its last component, checks that the path still resolves inside the runs directory to that same open file, and reads from it. On Linux it also reads the path the kernel holds for the open file (`/proc/self/fd/<n>`) and refuses the file when that path is outside the runs directory, so a parent directory swapped between the checks cannot point the read elsewhere. An entry that changes between the check and the read answers `410 artifact_unreadable`, or `410 artifact_outside_runs_dir` when it then resolves outside the runs directory.

`HEAD /api/v1/runs/:runId` answers `200`, `404` or `410` with no body. It checks the record's path text against the runs directory and does not open the file or resolve links, so a `200` there can still be a `410` on `GET`.

## `GET /api/v1/runs/:runId/swarm`

Final agent-swarm snapshot for the run — every agent's name, department, role, mood, family edges, and last short-term memory entries. Lighter payload than the full RunArtifact when the consumer (network viz, org-chart UI, family-tree renderer) only needs the roster.

**200 response**

```json
{
  "runId": "run_a1b2c3d4-...",
  "swarm": {
    "turn": 6,
    "time": 6,
    "population": 98,
    "morale": 0.72,
    "births": 1,
    "deaths": 2,
    "agents": [
      {
        "agentId": "agent-001",
        "name": "Maria Chen",
        "department": "engineering",
        "role": "lead-engineer",
        "rank": "lead",
        "alive": true,
        "marsborn": false,
        "psychScore": 0.84,
        "age": 6,
        "generation": 0,
        "partnerId": "agent-014",
        "childrenIds": ["agent-072"],
        "featured": true,
        "mood": "focused",
        "shortTermMemory": [
          "Repaired the backup oxygen line.",
          "Argued with logistics over the rover schedule."
        ]
      }
    ]
  }
}
```

**Status codes**

- `404 not_found` — unknown `runId`
- `404 swarm_not_captured` — run exists but did not produce a swarm (e.g., `batch-point` mode that bypassed the turn loop)
- `410 artifact_unavailable` — record exists but the artifact file was never preserved
- `410 artifact_unreadable` — file is missing or unreadable on disk
- `410 artifact_outside_runs_dir` — same as `/runs/:runId`

Equivalent SDK access: `WorldModel.swarm(artifact)` (or `artifact.finalSwarm` directly). Derived helpers: `WorldModel.swarmByDepartment(artifact)`, `WorldModel.swarmFamilyTree(artifact)`.

## `POST /api/v1/runs/:runId/replay`

Re-run each between-turn step the stored artifact recorded, from the state the run started it from, and report whether every fresh state equals the state the run saved right after that step (`scenarioExtensions.kernelSnapshotsAfterProgression`) under canonical JSON. A 200 result is persisted to the run-history store, so `/runs/aggregate` counters reflect every replay that compared.

**No request body.**

**200 response**

```json
{ "matches": true,  "divergence": "" }
```

```json
{ "matches": false, "divergence": "/scenarioExtensions/kernelSnapshotsAfterProgression/3/state/metrics/population (188 vs 186)" }
```

**Status codes**

- `404 not_found` — unknown `runId`
- `410 artifact_unavailable` / `410 artifact_unreadable` / `410 artifact_outside_runs_dir` — same as `/runs/:runId`
- `410 scenario_unavailable` — the scenario referenced by the artifact is not in the active catalog
- `422 replay_preconditions_unmet` — replay refused, with the underlying `WorldModelReplayError` message: the artifact holds no snapshots or no decisions, it was saved before the turn loop kept the state after each between-turn step, or it lacks the state a step started from or the state after a turn's step, which replay cannot verify a run without ([#235](https://github.com/framerslab/paracosm/issues/235)). No result is recorded.

## `POST /api/v1/runs/:runId/replay-result`

Record a client-side replay outcome (used by the dashboard's verification loop when replay runs in the browser instead of the server).

**Request body**

```json
{ "matches": true }
```

**Responses**

- `204 No Content` on success
- `400 invalid_json` — body did not parse
- `400 matches must be a boolean` — `matches` field missing or wrong type
- `404 not_found` — unknown `runId`
- `413 body_too_large` — the body is over 16 KiB (16,384 bytes); nothing is recorded

## `GET /api/v1/bundles/:bundleId`

Bundle metadata plus the member RunRecords, sorted by `createdAt` ascending. Used by the Compare modal as its entry-point fetch.

**200 response**

```json
{
  "bundleId": "8b1e...",
  "scenarioId": "mars-genesis",
  "createdAt": "2026-04-30T12:34:56.789Z",
  "memberCount": 3,
  "members": [
    { "runId": "run_...", "actorName": "Maya Patel", "...": "RunRecord" }
  ]
}
```

**Status codes**

- `404` — bundle id has no members
- `501` — store implementation does not support bundle queries (only the noop in-memory store hits this)

## `GET /api/v1/bundles/:bundleId/aggregate`

Bundle-scoped rollup. Used by the Compare modal's `AggregateStrip`.

**200 response**

```json
{
  "bundleId": "8b1e...",
  "count": 3,
  "costTotalUSD": 1.07,
  "meanDurationMs": 218000,
  "outcomeBuckets": {}
}
```

`outcomeBuckets` is currently always `{}` — outcome classification is queued for the v2 fingerprint extraction pass. The dashboard treats an empty map as "data unavailable" gracefully.

## `POST /api/v1/library/import`

Import an externally-produced RunArtifact (Studio JSON drop, shared export, replay clone) so it shows up in the Library tab. The artifact is enriched into a RunRecord and inserted into the active store.

The server keeps its own copy of each imported artifact: it writes the artifact to a new file, `v3-imported-<hash of runId>-<random suffix>.json`, in its runs directory (`PARACOSM_OUTPUT_DIR`, else `<cwd>/output`) and the record's artifact path points at that file. The file is created exclusively: an entry already at that name, a link included, is never followed or overwritten. No file path is taken from the request; a `scenarioExtensions.outputPath` in the imported artifact is dropped from the stored copy. `GET /api/v1/runs/:runId` then serves the imported artifact.

When two imports of one `runId` arrive together, the record stored first is kept with its file; the other import answers `alreadyExisted: true` and removes the file it wrote. An import whose record cannot be read back right after its insert keeps its file and answers `alreadyExisted: false`.

The server writes the copy as compact JSON. One client address imports at most `PARACOSM_IMPORTS_PER_DAY` new runs a day (UTC), 500 unless set; a run id the store already holds is not counted. An import past the limit answers `429` with `Retry-After` set to the seconds until the next UTC midnight and `{ "error": "Daily import limit reached. Try again tomorrow." }`, with `bundleId` and `insertedSoFar` for a bundle part of which was stored before the limit.

The output-retention sweep at boot (`OUTPUT_RETENTION_DAYS`, default 30, removes `v3-*.json` files older than that) and `POST /admin/data/wipe` with `wipeOutput: true` (removes `v3-*.json` files) work on the same runs directory, so they remove imported copies as they do run output. Neither removes any other file in the directory.

**Request body — single**

```json
{ "artifact": { "metadata": { "...": "..." }, "trajectory": { "...": "..." } } }
```

**Request body — bundle (1–50 artifacts share one bundleId)**

```json
{ "artifacts": [ { "...": "RunArtifact" }, { "...": "RunArtifact" } ] }
```

The route gives the bundle a new id, `bundle_` and a random UUID. With `addToBundle` set to an id of that form, such as the `bundleId` an earlier request's response gave or a new one the caller makes, the artifacts go in that bundle instead, and the response answers that id:

```json
{ "addToBundle": "bundle_8b1e...", "artifacts": [ { "...": "RunArtifact" } ] }
```

**A bundle over the request body limit**

The server refuses a request body over its limit, 5 MiB (5,242,880 bytes) unless `MAX_REQUEST_BODY_BYTES` sets another, with `413` and `Request body too large. Maximum N bytes.` A run saved with `captureSnapshots` carries three kernel snapshot sets in `scenarioExtensions` (`kernelSnapshotsPerTurn`, `kernelSnapshotAtStart`, `kernelSnapshotsAfterProgression`), which replay and fork read from the server's copy, so a bundle of such runs can pass the limit.

The Studio tab sends a bundle in one request when its JSON fits the limit, and otherwise in parts of whole runs, in the bundle's order, each part under the limit. The page names a new bundle in `addToBundle` on every part, the first included, so a part the server stored but whose reply was lost is in the bundle a later promote adds the rest to. Every run goes whole, its snapshots included. A part the server refuses with `413` and a lower limit is made again under that limit. A run whose JSON alone passes 5 MiB goes in one request with the rest of the bundle until the server has stated its limit, so a server started with a higher limit takes it; a run alone over the stated limit is refused with one message naming it, its size and the limit. The import stops at the first part the server does not take, and the page says which runs were imported, into which bundle, and which were not; promoting the same bundle again, from the same file dropped again included, adds the rest to that bundle while the Studio tab stays open.

**Responses (single)**

```json
{ "runId": "run_a1b2...", "alreadyExisted": false }
```

**Responses (bundle)**

```json
{
  "bundleId": "bundle_8b1e...",
  "runIds": ["run_a1b2...", "run_c3d4..."],
  "alreadyExisted": [false, false]
}
```

`alreadyExisted` is `true` for any artifact whose `metadata.runId` was already present in the store — re-imports collapse to the existing row instead of duplicating.

**Status codes**

- `201 Created` — single or full bundle inserted
- `400 Invalid artifact body` / `400 Bundle item N is not a valid RunArtifact` — Zod validation failed (shape or content)
- `400 Invalid bundle` — bundle missing `artifacts` array, exceeds the 50-artifact cap (`MAX_BUNDLE_SIZE`), or has an `addToBundle` that is not `bundle_` and a lowercase UUID
- `413`: the request body is over `MAX_REQUEST_BODY_BYTES` (5 MiB by default); the error states the limit
- `500` — store insert raised; the response includes `failedRunId` and (for bundles) `bundleId` and `insertedSoFar` so the client can show partial-success state and retry the broken artifact

## `GET /api/v1/demo/status`

Always reachable (not gated by `paracosmRoutesEnabled`). Lets a public-demo client probe what the running server allows.

**200 response**

```json
{
  "mode": "local",
  "replayAvailable": true,
  "authenticatedApiAvailable": false
}
```

`mode` is one of `local`, `hosted_demo`, `platform_api`. `replayAvailable` is `false` only in `platform_api` mode (where replay needs an authenticated path that is not yet exposed). `authenticatedApiAvailable` is `true` only in `platform_api` mode with `ADMIN_WRITE=true` and `ADMIN_TOKEN` set, the credential `/api/v1` takes there.

## `POST /api/event`

Served on the hosted demo alone (`PARACOSM_HOSTED_DEMO=true`); elsewhere the path answers `404`. The consent bar's script (`assets/consent/consent.js`) sends one page view per path while the visitor's count purpose is on, and the server forwards it to the shared Plausible instance with the visitor's `User-Agent` and address, as Plausible's [events API](https://plausible.io/docs/events-api) asks. The address is the connection's, or the `PARACOSM_CLIENT_IP_HEADER` header's value as the rate limits read it. The count limit below keys on it as the other per-client limits do (an IPv6 address by its /64), holds it in memory only, and drops it when its minute ends.

**Request body** (any content type; at most 4,096 bytes)

```json
{ "n": "pageview", "u": "/sim" }
```

`u` is the page's path. The server forwards one of the site's public pages in its place, on the counted domain: `/` (for `/` and `/index.html`), `/sim` (for `/sim` and any path under it, whose rest is never sent), or a built API docs page under its own path. A query string or fragment never leaves the server. No referrer is sent: the server ignores any other field of the body.

**Responses**

- `202`: the instance took the page view
- `204`: nothing was forwarded, because the request sent a privacy signal (`Sec-GPC: 1` or `DNT: 1`), came from a page on another site (the rule in "Base URL and gating"), or named a path that is no page of the site
- `400 invalid_event`: the body is not a page view of a path, or the request has no `User-Agent`
- `405`: a method other than `POST`
- `413 body_too_large`: the body is over 4,096 bytes
- `429 too_many_events`: the address (an IPv6 address by its /64) has sent 120 page views in its current minute, or 32 forwards are open at once; nothing is forwarded, and `Retry-After` is 60 seconds
- `502`: the instance did not take it (refused, unreachable or slower than 5 seconds)

## `POST /forget-keys`

Settings uses this endpoint when the visitor selects **Forget my keys**. It needs no request body. The server drops the run held for this visitor's dashboard cookie, stops it if it is running, and closes its pooled chat agents. On a local server, a visitor with no run of their own chats on the shared run they watch: its chat agents are closed and the run stays. A Digital Twin run's engine takes no stop signal, so a twin run in flight runs to its end, as it does after Clear. The response reports `runConfigsDropped` and `chatAgentsDropped`. Saved replays and run history remain available.

Model and search keys entered in Settings are kept for the current browser tab, and never in the last launch the dashboard saves on the device for Run again. A key-bearing request is refused (403) unless it came over TLS, or carries `X-Forwarded-Proto: https` from a proxy on the same computer or from behind the proxy `PARACOSM_CLIENT_IP_HEADER` names, or was sent to a loopback name (`localhost`, `127.0.0.1`, `[::1]`) with no proxy between, as through a container's published port. `GET /admin-config` reports `visitorKeyIdleMinutes`, the server's idle limit for the keys a finished run or a visitor-key chat agent holds.

## `POST /scenario/store`

The dashboard's scenario editor route. Any visitor can store a scenario JSON in memory. The stored scenario is the visitor's own: the visitor is the `paracosm_visitor` cookie the dashboard gives a browser, and every caller that sends no such cookie is one visitor, the anonymous one. A `paracosm_visitor` cookie whose value is not a UUID counts as no cookie, so that caller is the anonymous visitor too. When the JSON is a runnable scenario package, that visitor's `GET /scenarios` lists it with `source: "memory"`, and their `GET /scenarios/:id`, `POST /scenario/switch`, `GET /scenario?id=`, `POST /setup` and the Quickstart routes take its id. No other visitor lists, reads or runs it, and `GET /admin-config` lists each visitor's own stored ids under `memoryScenarios`.

A memory store never takes an id the shared catalog holds (a built-in such as `mars-genesis`, a scenario from the scenarios folder, or a compiled one), nor the id of a saved compiled draft the server is still re-compiling after a restart: the server answers `409` and the visitor gives their copy an id of its own.

The memory store holds a scenario of at most 256 KiB of JSON (`MEMORY_SCENARIO_MAX_BYTES`), at most 10 scenarios a visitor (`MEMORY_SCENARIOS_PER_VISITOR`), at most 20 for one address, every visitor id that address sends together (`MEMORY_SCENARIOS_PER_ADDRESS`; the address is the one the rate limiter keys on), and at most 100 in all (`MEMORY_SCENARIOS_CAP`). A visitor at any of those counts can still store over an id of their own. A stored scenario leaves the store:

- when 24 hours pass in which it was not stored again, read by its id or run (`MEMORY_SCENARIO_IDLE_MS`), so a full store makes room by itself;
- when its id enters the shared catalog, through an admin's disk save or its own visitor's [`POST /compile`](#post-compile) or Quickstart compile: from then on the id names the catalog's scenario;
- when `DELETE /admin/scenarios/:id` names it, from every visitor's store;
- when the server restarts.

With `saveToDisk: true` the server writes the scenario to `<scenarios folder>/<id>.json`, where the boot loader reads it after a restart, and, when it is runnable, puts it in the catalog every visitor reads; it does not also hold it in memory. The disk write takes the admin credential the `/admin/*` routes take: the server started with `ADMIN_WRITE=true` and `ADMIN_TOKEN` set, and the request's `X-Admin-Token` header equal to `ADMIN_TOKEN` (compared in constant time). Its id must be 1 to 128 letters, digits, hyphens or underscores, starting with a letter or digit, and must name one file directly in the scenarios folder. A refused request stores nothing, in memory or on disk.

The dashboard sends the header from the token an operator enters in Settings, in the Admin Token field. The field shows only when `GET /admin-config` answers `adminWrite: true`. It is a password field with Save and Clear; the token is kept in that browser's localStorage under `paracosm:adminToken` (in memory until the page reloads, where the browser cannot store it) and is sent as `X-Admin-Token` on four calls only: this disk write (Save to Disk in the scenario editor), `POST /admin/data/wipe` (Delete server data in the run actions menu), and `POST /scenarios/:id/rename` and `DELETE /admin/scenarios/:id` (Rename and Delete in a scenario's details). A `401` from any of the four clears the token it was sent with, and its message ends by saying where to enter the token. A token saved while the call was out is not the refused one: it is kept, and the message says the server refused the token the call was sent with and that the newer one is saved. A request header carries characters up to U+00FF only, so Save refuses a token holding any other character, or a control character, and says which characters a token may hold: U+0020 to U+007E and U+00A0 to U+00FF. A call that finds such a token stored clears it with the same words and sends nothing. Clear local data in the run actions menu clears that browser's cached data, with a token saved or not, and sends `POST /clear`, which lets go of that browser's own run on the server and stops it when it is running, so a reload does not replay the events just cleared; run history, saved sessions and output files are kept. Its question says so. Clear local data in the RUN menu's local history sends the same `POST /clear` as well as emptying that browser's saved-runs ring, and its tooltip and question say so too. Delete server data, beside it in the same menu, shows only where `adminWrite` is true and a token is saved; it sends `POST /admin/data/wipe` with `wipeRuns`, `wipeSessions` and `wipeOutput`, after a question that says it deletes the server's stored runs, saved sessions and run output files for every visitor, and that every page showing a finished run the server holds, the asking page included, empties its view of it: the wipe drops those runs and tells their pages with `run_cleared`. A finished Digital Twin's result is a view of its run and empties with it. A run in progress keeps running. When the dashboard's `GET /admin-config` request fails, it asks again the next time the run actions menu opens. When the wipe's answer does not arrive or cannot be read, the dashboard says the outcome could not be confirmed. When the server answers the wipe with an error of its own (a `5xx` other than the `503` of a server with no `ADMIN_TOKEN`), the dashboard shows the error and says the server may have deleted some of its data before it: the wipe deletes store by store and restores nothing.

**Request body**

```json
{ "scenario": { "id": "deep-ocean-station", "...": "..." }, "saveToDisk": false }
```

**200 response**

```json
{ "stored": true, "id": "deep-ocean-station", "savedToDisk": false, "adminWrite": false, "switchable": true }
```

`adminWrite` is the server's `ADMIN_WRITE` setting. `switchable` is `true` when the JSON is a runnable scenario package, which `POST /scenario/switch` can then pick.

**Status codes**

- `200` — stored (and written, when `savedToDisk` is `true`)
- `400 scenario with id required` — no `scenario` or no `scenario.id`
- `400 The scenario id must be a string.` — a memory store whose id is not a string
- `409` — a memory store under an id the shared catalog holds, or the id of a saved compiled draft still re-compiling after a restart
- `400 Invalid scenario id for a disk write` — `saveToDisk` with an id outside the pattern above (a path separator, a dot, a percent sign, a null byte, over 128 characters, or not a string)
- `401 Invalid or missing X-Admin-Token header` — `saveToDisk` without the header or with a wrong token
- `403 ADMIN_WRITE not enabled on this server` — `saveToDisk` on a server started without `ADMIN_WRITE=true`
- `503` — `saveToDisk` on a server with `ADMIN_WRITE=true` and no `ADMIN_TOKEN` (fail closed)
- `413` — the body is over `MAX_REQUEST_BODY_BYTES` (5 MiB by default), or a memory store's scenario is over 256 KiB of JSON
- `507` — a memory store of a new id by a visitor who holds 10, from an address that holds 20, or when the store holds 100 in all

At boot the server restores the drafts the compile-from-seed flow saved under `<scenarios folder>/compiled/`, newest first, at most 50 (`COMPILED_SCENARIOS_CAP`); a draft whose id is outside the pattern above is skipped with a log line naming its file, and the drafts past the cap are left unread, in one log line. A draft whose id the catalog already holds (a built-in or a scenario from the scenarios folder) is left out with a log line and is not compiled: the catalog's scenario stays.

Boot restores each saved draft whose hooks its file or the compiler's disk cache holds with no model call, on any host, whatever provider keys it holds. The compile-from-seed flow saves, beside the scenario, the source of every hook its compile kept, the model that generated them and the compile schema version (`_persistHooks`; a compile that kept every hook on its fallback saves a record that names no hook), and boot rebuilds the hooks from that record alone. A file written before saved files carried their hooks is restored from the hooks the compiler's disk cache (`.paracosm/cache/`) holds for its exact JSON, under the model that wrote them, when one or more of them restores. A hook the record or the cache does not hold (one the compile left on its fallback), or holds in a form the hook runner now refuses, gets the compiler's fallback for it; a refused one is logged. Only a draft that neither holds is compiled again: its file carries no record of the current compile schema version, and the cache holds no hook of it that restores. On the hosted demo that compile runs on the host's OpenAI key alone, so a host with no OpenAI key leaves such a draft out, with a log line.

The shared catalog holds at most 50 compiled scenarios (`COMPILED_SCENARIOS_CAP`), whatever compiled them: Quickstart compiles, `POST /compile`, and the saved drafts boot re-compiles, which count from the start of boot. When a compile takes the catalog past 50, one compiled scenario leaves: on the hosted demo the oldest of the client address that holds the most (each draft loaded at boot counts as an address of its own), elsewhere the oldest. A scenario that a run the server holds is in never leaves; when such runs hold every other compiled scenario, none leaves, so the catalog passes 50 only when `PARACOSM_MAX_RUNS` and `PARACOSM_MAX_HELD_RUNS` together reach 50. A scenario that leaves goes as `DELETE /admin/scenarios/:id` takes it, its file included: a pick of it reads as no pick and gets the default, a request that names it answers as one that names an unknown id, and for 31 days, or until the server restarts, no compile lands under its id: `POST /compile` answers `409` and the Quickstart takes the next free id. A visitor's own copy held in memory (`POST /scenario/store` without `saveToDisk`) may use the id, and only that visitor sees it. The folder `<scenarios folder>/compiled/` holds the files of the compiled scenarios in the catalog. Its clean-up, which runs while the folder holds more than 50, deletes the oldest `<id>.json` files whose JSON holds that same id and whose scenario is neither a compiled scenario in the catalog nor a draft boot is re-compiling. A disk save (`saveToDisk`) under the id of a compiled scenario or a draft boot is re-compiling deletes that scenario's file in `compiled/`. When the saved JSON is not a runnable package (`switchable: false`), the save also takes the compiled scenario out of the catalog and ends boot's re-compile of it; the boot loader reads the saved file at the next restart when it is runnable or carries `dataDrivenHooks`.

## `POST /compile`

The scenario editor's compile route. It compiles the scenario JSON in `scenario` and puts the result in the shared catalog under the JSON's `id`, with `source: "compiled"`, where every visitor's `GET /scenarios` lists it. It becomes nobody's pick: the editor that compiled it posts `/scenario/switch` with the id. The catalog holds at most 50 compiled scenarios; past that one leaves, as the boot paragraph under [`POST /scenario/store`](#post-scenariostore) says.

A compile never replaces a scenario. The server answers `409` when the id is taken, which is any of:

- the shared catalog holds it: a built-in, a scenario from the scenarios folder, or a compiled scenario, whoever compiled it, the caller included;
- it is the id of a saved compiled draft the server is still re-compiling after a restart;
- it is the id of a compiled scenario that left the catalog to make room, for 31 days after it left or until the server restarts;
- another visitor holds it in memory (`POST /scenario/store`).

The refusal comes before the stream starts, before the compiler runs and before the request counts toward the day's compiles. To change a compiled scenario, compile it under a new id. An id that only the caller stored in memory is free: the compiled scenario lands in the catalog and the stored copy leaves the memory store.

The id is checked again when the compile finishes. If something took it while the compile ran, the stream ends with an `error` event that carries the same message, and the catalog is unchanged.

The Quickstart compile (`POST /api/quickstart/compile-from-seed`) picks the scenario's id itself. When that id is taken, the scenario lands under the next free id (`<id>-2`, then `<id>-3`), with the id cut short where it must be so the whole is at most 64 characters, the longest id the Quickstart routes take, and the status answer's `scenarioId` and `scenario.id` report the id it landed under. A finished compile whose scenario left the catalog to make room answers its status with `status: "error"` and no scenario, and the same seed sent again starts a new compile. A request with the same seed joins a pending or finished compile only when it runs on the same provider and the same keys (the caller's own, or the host's); otherwise it starts a compile of its own. At most 4 such compiles are pending at once (503 with `Retry-After: 60` above it), and one pending for 10 minutes ends with `status: "error"` and is never installed.

**Request body**

```json
{ "scenario": { "id": "deep-ocean-station", "...": "..." }, "seedText": "optional grounding text", "webSearch": true }
```

Optional fields: `provider`, `model`, `seedText`, `seedUrl`, `webSearch` (default `true`), `maxSearches`, `apiKey`, `anthropicKey`.

**200 response**

A `text/event-stream`: `status`, one `progress` event per hook, a `compile_validation_fallback` event for each hook that fell back, `compile_metrics`, then `complete` (`{ "id", "version", "departments", "hooks" }`) or `error` (`{ "error" }`).

**Status codes**

- `200`: the stream above
- `400 scenario JSON object required`: no `scenario` object in the body
- `413 A scenario sent to /compile is at most 256 KiB of JSON.`: the `scenario` is over 256 KiB (262,144 bytes) of JSON; refused before the 409 check, the stream and the day's compiles
- `403 cross_site_refused`: on the hosted demo, a request from a page on another site with no key of its own, or with a seed the host's search or scraping keys would read
- `409 "<id>" is taken on this server. Give your scenario an id of its own.`: the id is taken, as above
- `429`: on the hosted demo, the address is past its compiles for the day and the request carries no API key of its own
- `503`: on the hosted demo, a request with no key of its own on a host that holds no OpenAI key; refused before the day's compiles count it

---

## `POST /scenarios/:id/rename`

Changes the display name (`labels.name`) of a compiled scenario, the name every visitor sees, and writes the scenario's file under `<scenarios folder>/compiled/` so the name holds after a restart. The id never changes. It takes the admin credential the `/admin/*` routes take: the server started with `ADMIN_WRITE=true` and `ADMIN_TOKEN` set, and the request's `X-Admin-Token` header equal to `ADMIN_TOKEN`. The dashboard's scenario drawer shows the rename control only when an admin token is saved in the browser, as it does the delete control. A rename the server refuses with `401` clears the token it was sent with and says where to enter one, as the delete does.

**Request body**

```json
{ "name": "Pandemic Sim" }
```

The name loses control characters and `<` `>`, its runs of whitespace become one space, and it is cut to 100 characters.

**200 response**

```json
{ "id": "dual-superintelligence-council-x9k2", "name": "Pandemic Sim" }
```

**Status codes**

- `200` — renamed and written
- `400 invalid_path` — the path holds a percent escape that does not decode
- `400 cannot_rename_non_compiled` — a built-in or a scenario from the scenarios folder
- `400 invalid_json_body` or `400 name_required` — no JSON body, or a name that is empty once cleaned
- `401 Invalid or missing X-Admin-Token header` — no header or a wrong token
- `403 ADMIN_WRITE not enabled on this server` — a server started without `ADMIN_WRITE=true`
- `404 scenario_not_found` — no scenario has that id, or the scenario left the catalog before the request's body arrived
- `503` — a server with `ADMIN_WRITE=true` and no `ADMIN_TOKEN` (fail closed)

---

## Error envelope

Every error response is JSON-encoded with at minimum an `error` field. Most also include a contextual key (`runId`, `scenarioId`, `path`) to help clients build readable messages.

```json
{ "error": "not_found", "runId": "run_does_not_exist" }
```

Unknown routes under `/api/v1/` return `404 unknown_platform_route` with the requested path echoed.

A request whose path holds a percent escape that does not decode (`/scenarios/%E0`, `/scenarios/%ZZ`) answers `400 invalid_path`, whatever the route. A path the URL parser refuses, such as `//`, is answered by the routes after the platform routes, which give `404`. An error a route does not handle answers `500 internal_error` and is logged; the server goes on answering other requests.

## Related docs

- [Cookbook](./COOKBOOK.md) — SDK-level walkthrough with input + output JSON for every public method
- [Architecture](./ARCHITECTURE.md) — engine, runtime, CLI layering and replay semantics

## Dashboard deep links

The dashboard at `/sim` also accepts a client-side query-param contract for sharing runs without server upload — useful for one-click Reddit posts and bug reports. Not an HTTP endpoint, but documented next to the rest of the wire-level surface for discoverability.

| Param      | Required | Behaviour |
| ---------- | -------- | --------- |
| `?load=`   | yes      | URL of a remote `.json` save (http/https only, CORS-readable). A file on another site is fetched only after the visitor answers a question that names that site; Cancel fetches nothing. A file that a redirect serves from another origin than the link's is not loaded. |
| `?tab=`    | no       | Tab to land on after the load resolves: `sim` (default), `viz`, `reports`, `chat`, `library`, `settings`, `studio`. |
| `?autoload=` | no     | `1` or `true` skips the F9 preview-confirm modal. For a file on another site, the question naming the site is still asked first. |
| `?replay=` | no       | Session ID from a server-stored run. Switches the SSE source to `/sessions/:id/replay` instead of fetching a remote file. Pairs with `?tab=` the same way. |

A loaded run's provider error banner links only to the provider key and billing pages the server itself sends (`platform.openai.com`, `console.anthropic.com`); any other address in the file is shown as text.

Full example walkthrough: [Cookbook → Sharing a run via deep link](./COOKBOOK.md#sharing-a-run-via-deep-link-loadurltabautoload).
