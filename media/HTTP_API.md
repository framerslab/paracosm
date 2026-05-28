# Paracosm HTTP API Reference

The dashboard server (`paracosm dashboard`) exposes a versioned HTTP surface under `/api/v1/*`. The same routes power the React dashboard and any external client. This page documents every endpoint, its request shape, response shape, and status codes.

Source of truth: [`src/server/routes/platform-api.ts`](../src/server/routes/platform-api.ts), [`src/server/routes/public-demo.ts`](../src/server/routes/public-demo.ts), [`src/server/routes/bundle.ts`](../src/server/routes/bundle.ts), and [`src/server/routes/library-import.ts`](../src/server/routes/library-import.ts).

For the SDK (`WorldModel.simulate()`, `WorldModel.batch()`, `WorldModel.intervene()`, etc.) see the [Cookbook](./COOKBOOK.md). This page is the wire-level reference for the HTTP surface only.

## Base URL and gating

- Local: `http://localhost:3456` (override with `PARACOSM_PORT`)
- All `/api/v1/runs*` and `/api/v1/bundles/*` routes return **403 `run_history_routes_disabled`** when the server is started with `PARACOSM_ENABLE_RUN_HISTORY_ROUTES=false`. Default is `true` except in `hosted_demo` mode.
- Routes are CORS-permissive (`Access-Control-Allow-Origin: *`) for local dashboard development.

## Endpoint index

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/v1/runs` | List runs with filters and pagination |
| GET    | `/api/v1/runs/aggregate` | Rollup stats for the filtered set |
| GET    | `/api/v1/runs/:runId` | Run record + full RunArtifact JSON |
| GET    | `/api/v1/runs/:runId/swarm` | Final agent-swarm snapshot (lightweight) |
| POST   | `/api/v1/runs/:runId/replay` | Re-execute the kernel against the stored artifact |
| POST   | `/api/v1/runs/:runId/replay-result` | Record a client-side replay outcome |
| GET    | `/api/v1/bundles/:bundleId` | Bundle metadata + member RunRecords |
| GET    | `/api/v1/bundles/:bundleId/aggregate` | Bundle-scoped rollup |
| POST   | `/api/v1/library/import` | Import an externally-produced RunArtifact |
| GET    | `/api/v1/demo/status` | Public-demo capability flags (always reachable) |

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

Note: `artifactPath` is stripped from the public projection of every record. Use `GET /api/v1/runs/:runId` to load the artifact JSON.

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
  "record": { "runId": "run_a1b2...", "...": "as in /runs response" },
  "artifact": { "metadata": { "...": "..." }, "trajectory": { "...": "..." } }
}
```

**Status codes**

- `404 not_found` — `runId` not in the run-history store
- `410 artifact_unavailable` — record exists but `artifactPath` was never preserved (legacy run)
- `410 artifact_unreadable` — file was preserved but is missing or unreadable on disk

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

Equivalent SDK access: `WorldModel.swarm(artifact)` (or `artifact.finalSwarm` directly). Derived helpers: `WorldModel.swarmByDepartment(artifact)`, `WorldModel.swarmFamilyTree(artifact)`.

## `POST /api/v1/runs/:runId/replay`

Re-execute the kernel against the stored artifact and report whether the replay matches byte-for-byte. The result is persisted to the run-history store, so `/runs/aggregate` counters reflect every attempt.

**No request body.**

**200 response**

```json
{ "matches": true,  "divergence": "" }
```

```json
{ "matches": false, "divergence": "metric.population at turn 4: 188 vs 186" }
```

**Status codes**

- `404 not_found` — unknown `runId`
- `410 artifact_unavailable` / `410 artifact_unreadable` — same as `/runs/:runId`
- `410 scenario_unavailable` — the scenario referenced by the artifact is not in the active catalog
- `422 replay_preconditions_unmet` — replay refused because the kernel cannot recreate the input state (returns the underlying `WorldModelReplayError` message)

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

**Request body — single**

```json
{ "artifact": { "metadata": { "...": "..." }, "trajectory": { "...": "..." } } }
```

**Request body — bundle (1–50 artifacts share one generated bundleId)**

```json
{ "artifacts": [ { "...": "RunArtifact" }, { "...": "RunArtifact" } ] }
```

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
- `400 Invalid bundle` — bundle missing `artifacts` array or exceeds the 50-artifact cap (`MAX_BUNDLE_SIZE`)
- `500` — store insert raised; the response includes `failedRunId` and (for bundles) `insertedSoFar` so the client can show partial-success state and retry the broken artifact

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

`mode` is one of `local`, `hosted_demo`, `platform_api`. `replayAvailable` is `false` only in `platform_api` mode (where replay needs an authenticated path that is not yet exposed). `authenticatedApiAvailable` is `true` only in `platform_api` mode.

---

## Error envelope

Every error response is JSON-encoded with at minimum an `error` field. Most also include a contextual key (`runId`, `scenarioId`, `path`) to help clients build readable messages.

```json
{ "error": "not_found", "runId": "run_does_not_exist" }
```

Unknown routes under `/api/v1/` return `404 unknown_platform_route` with the requested path echoed.

## Related docs

- [Cookbook](./COOKBOOK.md) — SDK-level walkthrough with input + output JSON for every public method
- [Architecture](./ARCHITECTURE.md) — engine, runtime, CLI layering and replay semantics

## Dashboard deep links

The dashboard at `/sim` also accepts a client-side query-param contract for sharing runs without server upload — useful for one-click Reddit posts and bug reports. Not an HTTP endpoint, but documented next to the rest of the wire-level surface for discoverability.

| Param      | Required | Behaviour |
| ---------- | -------- | --------- |
| `?load=`   | yes      | URL of a remote `.json` save (http/https only, CORS-readable). |
| `?tab=`    | no       | Tab to land on after the load resolves: `sim` (default), `viz`, `reports`, `chat`, `library`, `settings`, `studio`. |
| `?autoload=` | no     | `1` or `true` skips the F9 preview-confirm modal. |
| `?replay=` | no       | Session ID from a server-stored run. Switches the SSE source to `/sessions/:id/replay` instead of fetching a remote file. Pairs with `?tab=` the same way. |

Full example walkthrough: [Cookbook → Sharing a run via deep link](./COOKBOOK.md#sharing-a-run-via-deep-link-loadurltabautoload).
