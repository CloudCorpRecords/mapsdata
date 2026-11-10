# Changelog

## 0.1.0 (2026-10-28)

- First release: a forwarding client for the hosted HasData Google Maps MCP server, serving all six captured tools locally for tools/list and forwarding every tools/call upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when issued).
- Tools: `hasdata_google_maps_contributor_reviews_getMapReviews`, `hasdata_google_maps_photos_getMapPhotos`, `hasdata_google_maps_place_getPlaceDetails`, `hasdata_google_maps_posts_getMapPosts`, `hasdata_google_maps_reviews_getMapReviews`, `hasdata_google_maps_search_performMapSearch`.
- Upstream results pass through verbatim; upstream failures surface as `mapsdata error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). Upstream endpoint overridable via `HASDATA_GOOGLE_MAPS_MCP_URL`; when `HASDATA_API_KEY` is set it is sent as an `x-api-key: <value>` header on every upstream request.
