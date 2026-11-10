# mapsdata

mapsdata is a small local bridge to the hosted HasData
Google Maps MCP server, which returns Google Maps data
as JSON. Search for places by keyword — optionally
around GPS coordinates — and pull back the local pack
with ratings, hours, phone and website; then follow a
placeId into full place details, its reviews, its
photo gallery, and its latest posts and offers. A
sixth tool lists every review one Local Guide
contributor has written, for reviewer-profile and
trust checks.

The bridge keeps no place data of its own. It serves
the upstream server's tool list locally, exactly as
captured from the live endpoint, and forwards each
tool call upstream, returning the result untouched.
Everything in the surface is read-only over data
Google Maps shows publicly for places and reviewers:
there is no posting, messaging, or booking tool in it.

## Tools

- `hasdata_google_maps_search_performMapSearch` — run
  a Google Maps search. Required: `q`. Optional:
  `domain`, `gl`, `hl`, `start` (offset paging), and
  `ll` (GPS coordinates as `@lat,lng,zoomz`; required
  when `start` is present). Returns the local pack
  list with placeId, name, address, coordinates,
  rating, review count, price level, categories,
  phone, website, hours, and thumbnail.
- `hasdata_google_maps_place_getPlaceDetails` — fetch
  one place in full. Required: `placeId`. Optional:
  `domain`, `hl`, and `fetchWebResults` (also returns
  the place panel's web results). Returns name,
  address, coordinates, phone, website, categories,
  hours, rating, review count, price level, photos,
  attributes, and plus code.
- `hasdata_google_maps_reviews_getMapReviews` —
  paginated reviews for one place, by `dataId` or
  `placeId`. Optional: `hl`, `sortBy` (`mostRelevant`,
  `newestFirst`, `ratingHigh`, `ratingLow`), `topicId`
  filter, and `nextPageToken`. Returns author, rating,
  text, dates, likes, owner responses, photos, and
  local-guide flags.
- `hasdata_google_maps_photos_getMapPhotos` — the
  photo gallery of one place, by `dataId` or `placeId`,
  paginated with `nextPageToken` and filterable by
  `categoryId`. Returns each photo's image URL and
  thumbnail.
- `hasdata_google_maps_posts_getMapPosts` — the
  latest Google Maps posts (offers, events,
  announcements) for one place, by `dataId` or
  `placeId`, with `hl` language targeting. Returns
  per-post title, description, image, posted date,
  link, and business name.
- `hasdata_google_maps_contributor_reviews_getMapReviews`
  — every review authored by one Local Guide.
  Required: `contributorId`. Optional: `hl`, `gl`,
  `num` (10–200 per page), and `nextPageToken`.
  Returns per-review rating, text, date, place name
  and address, photos, and owner responses.

## Configuration

- `HASDATA_GOOGLE_MAPS_MCP_URL` (optional) — override
  the upstream endpoint. Defaults to
  `https://mcp.hasdata.com/mcp?apis=google_maps` (the
  query string is part of the pinned URL). (The
  override hook is this rebuild's own labelled
  reconstruction.)
- `HASDATA_API_KEY` (optional) — when set, every
  upstream request carries an `x-api-key: <key>`
  header, for the caller's own HasData API key. When
  it is not set, no key header is sent. (The header
  name and the env name are pinned by the original's
  registry record; forwarding the key from this env
  var is a labelled reconstruction — the original
  surface was captured keyless.)

### Forwarding mechanics

On the first tool call the client opens a streamable
HTTP session with the upstream: a JSON-RPC
`initialize` request (protocolVersion `2025-03-26`,
clientInfo name `mapsdata`), then a
`notifications/initialized` notification, then the
`tools/call` request carrying the caller's arguments
unchanged. When the upstream answers `initialize`
with an `Mcp-Session-Id` header, that value rides on
every later request of the session, which is reused
for the life of the process. Replies may arrive as
plain JSON or as server-sent events; both are read.

Successful upstream results pass through verbatim,
including any `isError` flag the upstream sets.
Failures — a JSON-RPC error, a non-2xx status, an
unreadable response, or a request that cannot be
completed — come back as an `isError` result whose
text starts with `mapsdata error:` (this rendering
is this rebuild's own labelled reconstruction).

## CLI

Each tool is also a subcommand taking one JSON
argument string:

```bash
npx @reneturcios/mapsdata hasdata_google_maps_search_performMapSearch '{"q":"coffee near Union Square","hl":"en"}'
npx @reneturcios/mapsdata hasdata_google_maps_place_getPlaceDetails '{"placeId":"ChIJN1t_tDeuEmsRUsoyG83frY4"}'
npx @reneturcios/mapsdata --version
```

Exit codes: `0` on success, `1` on an `isError`
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/mapsdata mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "mapsdata": {
      "command": "npx",
      "args": ["-y", "@reneturcios/mapsdata", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/mapsdata
docker run --rm ghcr.io/cloudcorprecords/mapsdata --version
```

The container's default command is `mcp`, so the first
form is a stdio MCP server; any other arguments reach
the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed
JSON-RPC upstream — no live network calls.

## License

MIT — see `LICENSE`.
