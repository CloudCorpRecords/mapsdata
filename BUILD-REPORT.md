# BUILD REPORT — mapsdata

Rebuild of `com.hasdata/google-maps` v1.0.7 (remote-only, keyless capture)
as `@reneturcios/mapsdata` 0.1.0 / `io.github.CloudCorpRecords/mapsdata`.

## Fixture conflicts

**None.** The brief, the spec prose, and the fixture agree on all six tool
names and every required field. Required fields as served, taken from
the fixture (`harness/fixtures/hasdata-google-maps-tools-original.json`):

- `hasdata_google_maps_contributor_reviews_getMapReviews` — required: `contributorId`
- `hasdata_google_maps_photos_getMapPhotos` — required: (none)
- `hasdata_google_maps_place_getPlaceDetails` — required: `placeId`
- `hasdata_google_maps_posts_getMapPosts` — required: (none)
- `hasdata_google_maps_reviews_getMapReviews` — required: (none)
- `hasdata_google_maps_search_performMapSearch` — required: `q`

The fixture's tool literals (name, title, description, inputSchema —
including all six `title` keys, every property description,
`additionalProperties: false`, and the `$schema` key on every schema)
are served verbatim from `src/forward.ts`. The `TOOL_DEFS` literals were
generated programmatically from the fixture JSON (parsed and
re-serialised, never retyped) and verified deep-equal to the fixture's
6 tool objects before the first build; this was verified again by the
registration-integrity test (served tools/list deep-equals the fixture's
6 tool objects, in order) and again by the parity harness.

## What was built

All 19 factory files under `builds/mapsdata/`:

- `package.json` (`@reneturcios/mapsdata` 0.1.0, bin
  `mapsdata` → `dist/cli.js`, deps exactly `@modelcontextprotocol/sdk ^1`
  + `zod ^3`; devDeps `@types/node ^20`, `tsx ^4`, `typescript ^5`)
- `server.json` (description exactly the prescribed 87-char string
  "Google Maps data as JSON: place search and details, reviews, photos and posts by place.",
  measured at 87 chars; npm entry carries `"version": "0.1.0"`; OCI entry
  `ghcr.io/cloudcorprecords/mapsdata:0.1.0` carries **no** version field)
- `Dockerfile` (node:20-alpine both stages; server-name label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/mapsdata"`
  matches `server.json`)
- `tsconfig.json` (fleet-identical), `.gitignore`,
  `package-lock.json`, `README.md` (fresh prose), `LICENSE` (MIT,
  Copyright (c) 2026 Rene Turcios), `CHANGELOG.md` (single 0.1.0 entry,
  2026-10-28)
- `src/index.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`,
  `src/forward.ts` (core; exports `VERSION = "0.1.0"`)
- `test/forward.test.ts`
- `.github/workflows/{ci.yml, publish.yml, publish-container.yml,
  registry-publish.yml}` (container workflow: IMAGE
  `ghcr.io/cloudcorprecords/mapsdata`, smoke assertion on server name
  `mapsdata`)

Plus `BUILD-REPORT.md` (this file) and the `parity-out/` harness output.

## Design

- Forwarding client to `https://mcp.hasdata.com/mcp?apis=google_maps`
  (pinned; the query string is part of the pinned URL), overridable via
  `HASDATA_GOOGLE_MAPS_MCP_URL` (labelled reconstruction). tools/call is
  forwarded as a streamable-HTTP JSON-RPC client: initialize
  (protocolVersion `2025-03-26`, clientInfo `mapsdata`) →
  notifications/initialized → tools/call, honouring `Mcp-Session-Id`
  when issued; session established lazily and reused per client.
  Plain-JSON and SSE replies both parsed; the matching-id message
  wins; upstream results pass through verbatim (including `isError`
  and extra fields such as `structuredContent`).
- When `HASDATA_API_KEY` is set, an `x-api-key: <value>` header is
  sent on every upstream request (header name pinned by the registry
  record's remote declaration; forwarding it from this env var is a
  labelled reconstruction — the capture was keyless). When unset, no
  key header is sent. No `Authorization` header is sent in either
  case. Both branches are covered by tests.
- Upstream failures (JSON-RPC error, non-2xx status, malformed body,
  throwing/timing-out fetch) surface as `mapsdata error:` text
  results (labelled reconstruction).
- Registration via the MCP SDK **low-level** `Server` API
  (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers) serving
  the fixture literals exactly; no `McpServer` + zod registration.
  `src/mcp.ts` also exports `createServer` / `startMcpServer` /
  `handleCallTool` so the MCP layer is testable without a transport;
  the CLI's `mcp` subcommand starts it over stdio.
- Core takes an injectable fetch (`ForwardDeps.fetchFn`), so all tests
  run against a stubbed JSON-RPC upstream. No live network calls in
  tests; no live call claimed anywhere. The captured surface is six
  read-only fetches over public Google Maps place and reviewer data;
  no posting, messaging, or booking tool exists in the surface — none
  was added.

## Lockfile (Route 3, clean)

Generated in the build dir with `package.json` in place and no
`node_modules` present: `npm install --package-lock-only
--ignore-scripts --offline`. Verified: parses,
`name == @reneturcios/mapsdata`, **128 package entries**. Then
`npm install --ignore-scripts --offline` in the build dir for
`node_modules`, which succeeded on the offline route (no proxy
fallback needed). No write-guard failure occurred; `dist/` was built
in-tree normally.

## Verification (all in the build dir unless noted)

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli.js 2293 B, forward.js 21060 B,
  mcp.js 2676 B, all non-empty, with `.d.ts` + source maps)
- `node dist/cli.js --version` → `0.1.0`, exit 0
- `npm test` → **46 tests, 46 pass, 0 fail** (8 suites: registration
  integrity — served tools deep-equal the fixture's full 6 tool
  objects in order, each tool carrying exactly the fixture's keys,
  captured titles, required fields and every property key in order per
  tool, pinned version/endpoint; session establishment/reuse/
  session-id handling; env and explicit URL overrides;
  x-api-key header present on every request when the key is set /
  absent when unset / no Authorization header in either case;
  verbatim argument forwarding for all six tools; verbatim result
  pass-through incl. upstream isError and SSE; JSON-RPC/init/
  malformed/HTTP/throw/timeout failures → `mapsdata error:`;
  parseRpcBody JSON + SSE + matching-id selection; MCP-layer
  validation — unknown tool → MethodNotFound, array/string args →
  InvalidParams, omitted args → {}; CLI --version / -v / unknown
  exit 2 / bad-JSON exit 2)
- Parity: `python3 harness/parity.py --original
  harness/fixtures/hasdata-google-maps-tools-original.json --rebuild
  "stdio:node builds/mapsdata/dist/cli.js mcp" --out
  builds/mapsdata/parity-out` (run from `~/workspace/mcp-rebuild-100`)
  → **PASS, parity 100.0, 6/6 identical, no missing/extra/schema
  diffs** (see `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json top-level =
  npm-entry version = OCI tag = core `VERSION` = CHANGELOG heading
  (0.1.0); package.json `mcpName` = server.json `name` = Dockerfile
  label; server.json description measured at 87 chars; OCI entry
  confirmed to have no `version` field.

Clean-room: all prose and code written fresh for mapsdata; only the
mechanics were patterned on the sibling staydata build, and only the
fixture's tool literals are served verbatim.
