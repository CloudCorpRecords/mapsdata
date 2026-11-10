/**
 * mapsdata core: a forwarding client for the hosted
 * HasData Google Maps MCP server.
 *
 * No place is searched and no map page is read
 * locally. tools/list is answered from the literal tool
 * definitions below, taken verbatim from a live capture
 * of the upstream server (name, title, description and
 * inputSchema exactly as captured, including the title
 * key all six tools carry). A tools/call is forwarded over
 * a streamable-HTTP JSON-RPC session: an initialize
 * POST, a notifications/initialized POST, then the
 * tools/call POST, honouring the Mcp-Session-Id response
 * header when the upstream issues one. The session is
 * established lazily on the first forwarded call and
 * reused for the lifetime of the client.
 *
 * The upstream endpoint is pinned to
 * https://mcp.hasdata.com/mcp?apis=google_maps — the query
 * string is part of the pinned URL — and can be
 * overridden with the HASDATA_GOOGLE_MAPS_MCP_URL environment
 * variable (that override is a labelled reconstruction).
 * When HASDATA_API_KEY is set in the environment, every
 * upstream request carries an `x-api-key: <key>` header
 * (the header name is pinned by the registry record's
 * remote declaration; forwarding the key from this env
 * var is a labelled reconstruction — the capture itself
 * was taken keyless). When the variable is unset, no key
 * header is sent, and no Authorization header is sent in
 * either case.
 *
 * Upstream results pass through verbatim, including any
 * isError flag and any extra result fields. Failures — a
 * JSON-RPC error from the upstream, a non-2xx status, an
 * unparseable response, or a fetch that throws or times
 * out — surface as an isError result whose text starts
 * with `mapsdata error:` (that rendering is a labelled
 * reconstruction). Responses may be plain JSON or SSE
 * (data: lines); the JSON-RPC message with the matching
 * id wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://mcp.hasdata.com/mcp?apis=google_maps";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/hasdata-google-maps-tools-original.json)     */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "hasdata_google_maps_contributor_reviews_getMapReviews",
    "title": "google_maps_contributor_reviews: GET /",
    "description": "Get Map Contributor Reviews\n\nLists all Google Maps reviews authored by a specific Local Guide / contributor by contributorId, with language/country targeting and nextPageToken pagination. Returns per-review rating, text, date, place name, place address, photos, and owner responses. Use for reviewer reputation checks, detecting fake/bot review patterns, local-guide activity analysis, and building review-author profiles for trust scoring.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "contributorId": {
          "type": "string",
          "description": "Google Maps Contributor ID."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "gl": {
          "type": "string",
          "description": "The two-letter country code for the country you want to limit the search to. Provide one exact documented value (245 allowed), e.g. `ac`, `af`."
        },
        "num": {
          "type": "number",
          "description": "Number of results per page, ranging from 10 to 200."
        },
        "nextPageToken": {
          "type": "string",
          "description": "Defines the next page token. It is used for retrieving the next page results."
        }
      },
      "required": [
        "contributorId"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_maps_photos_getMapPhotos",
    "title": "google_maps_photos: GET /",
    "description": "Get Place Photos\n\nFetches the photo gallery of a Google Maps place by dataId or placeId, paginated with nextPageToken and filterable by categoryId. Returns each photo with image URL and thumbnail. Use for restaurant-menu extraction, venue/ambience visual audits, building rich place detail pages, and sourcing up-to-date imagery for POI listings.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "dataId": {
          "type": "string",
          "description": "Google Maps data ID. Either dataId or placeId should be set."
        },
        "placeId": {
          "type": "string",
          "description": "Unique reference to a place on Google Maps. Either dataId or placeId should be set."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "categoryId": {
          "type": "string",
          "description": "Filters photos by category."
        },
        "nextPageToken": {
          "type": "string",
          "description": "Token for fetching the next page of photos."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_maps_place_getPlaceDetails",
    "title": "google_maps_place: GET /",
    "description": "Get Place Details\n\nFetches full Google Maps place data by placeId with optional domain/language localization. Returns name, address, coordinates, phone, website, categories, hours, rating, review count, price level, photos, attributes/amenities, and plus_code. With fetchWebResults, also returns the place panel's web results (the business's own site and its Instagram, Facebook, delivery and other listings) with title, link, displayed link and snippet. Use for local SEO audits, POI enrichment, lead generation, competitor mapping, and building location-aware agents.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "placeId": {
          "type": "string",
          "description": "A unique identifier for the place. This ID can be obtained from Google Maps search results."
        },
        "domain": {
          "type": "string",
          "description": "Google domain to use. Default is google.com. Provide one exact documented value (195 allowed), e.g. `google.ac`, `google.ad`."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "fetchWebResults": {
          "type": "boolean",
          "description": "Also collect the place panel's \"Web results\" section (the business's website and its pages on Instagram, Facebook, delivery services, etc.) and return it as `webResults`. This takes an extra request to Google and costs 5 credits on top of the base. Default is false."
        }
      },
      "required": [
        "placeId"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_maps_posts_getMapPosts",
    "title": "google_maps_posts: GET /",
    "description": "Get Map Posts\n\nFetches the latest Google Maps Posts (timeline-style updates such as offers, events, announcements, and notices) for a place by dataId or placeId, with language targeting. Returns per-post title, description, image, posted_at, link, and source/business name. Use for small-business intelligence, local-marketing monitoring, competitor activity tracking, and surfacing current promotions and events from local merchants.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "dataId": {
          "type": "string",
          "description": "Google Maps data ID."
        },
        "placeId": {
          "type": "string",
          "description": "Unique reference to a place on a Google Map. Either dataId or placeId should be set."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_maps_reviews_getMapReviews",
    "title": "google_maps_reviews: GET /",
    "description": "Get Map Reviews\n\nPaginated fetch of Google Maps reviews for a place by dataId or placeId, with sort (mostRelevant, newestFirst, ratingHigh, ratingLow), topicId filter, and language. Returns per-review author name and profile link, star rating, text, published/relative date, likes count, owner response, attached photos, and local-guide flag. Use for reputation management, sentiment and topic mining, competitor review benchmarking, and feeding review data into summarization or trust-score LLMs.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "dataId": {
          "type": "string",
          "description": "Google Maps data ID."
        },
        "placeId": {
          "type": "string",
          "description": "Unique reference to a place on a Google Map. Either dataId or placeId should be set."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "sortBy": {
          "type": "string",
          "enum": [
            "mostRelevant",
            "newestFirst",
            "ratingHigh",
            "ratingLow"
          ],
          "description": "Parameter used for sorting and refining results."
        },
        "topicId": {
          "type": "string",
          "description": "Defines the ID of the topic you want to use for filtering reviews."
        },
        "nextPageToken": {
          "type": "string",
          "description": "Defines the next page token. It is used for retrieving the next page results."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_maps_search_performMapSearch",
    "title": "google_maps_search: GET /",
    "description": "Get Google Maps Search Results\n\nRuns a Google Maps search by keyword plus optional GPS coordinates (@lat,lng,zoomz via `ll`) with language, country, domain, and offset-based pagination (start). Returns the local pack list with placeId, name, address, coordinates, rating, review count, price level, categories, phone, website, hours, and thumbnail. Use for local lead generation, competitor density mapping, market expansion research, hyperlocal directories, and feeding placeIds into the Maps Place, Reviews, or Photos endpoints.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "q": {
          "type": "string",
          "description": "Search query term or phrase."
        },
        "domain": {
          "type": "string",
          "description": "Google domain to use. Default is google.com. Provide one exact documented value (195 allowed), e.g. `google.ac`, `google.ad`."
        },
        "gl": {
          "type": "string",
          "description": "The two-letter country code for the country you want to limit the search to. Provide one exact documented value (245 allowed), e.g. `ac`, `af`."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "start": {
          "type": "number",
          "description": "Specifies the result offset for pagination purposes. The offset dictates the number of rows to skip from the beginning of the results. This is useful for accessing subsequent pages of search results. For example, an offset of 0 (the default value) returns the first page of results, 20 returns the second page, 40 returns the third page, and so on. This parameter is especially relevant when used in conjunction with the 'll' parameter for location-based searches.\n"
        },
        "ll": {
          "type": "string",
          "description": "GPS coordinates of the location where the search query is to be performed. This parameter is required if the 'start' parameter is present. The format for the `ll` parameter is `@` followed by latitude, longitude, and zoom level, separated by commas. The latitude and longitude should be in decimal degrees, and the zoom level is an integer. Example: `@40.7455096,-74.0083012,14z`.\n"
        }
      },
      "required": [
        "q"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` is one of the captured tools. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `mapsdata error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Parse a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * one is present, else the last parseable message, else
 * null when nothing parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not JSON; ignore this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding one upstream session. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client (the
 * process lifetime when the client is the MCP server's
 * or a one-shot client for the CLI).
 */
export class MapsdataClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).HASDATA_GOOGLE_MAPS_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private apiKey(): string | null {
    const raw = (this.deps.env ?? process.env).HASDATA_API_KEY;
    if (raw && raw.trim() !== "") return raw.trim();
    return null;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.apiKey();
    if (key !== null) headers["x-api-key"] = key;
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "mapsdata", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // The notification response body carries nothing we need.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Pass the upstream result through verbatim.
    return result;
  }
}

/** Create a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): MapsdataClient {
  return new MapsdataClient(deps);
}

/** One-shot helper: a fresh client per call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new MapsdataClient(deps).callTool(name, args);
}
