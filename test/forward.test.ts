import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  MapsdataClient,
  callTool,
  createClient,
  DEFAULT_ENDPOINT_URL,
  parseRpcBody,
  PROTOCOL_VERSION,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { handleCallTool } from "../src/mcp.js";
import type {
  FetchFn,
  FetchResponseLike,
  ToolDef,
  ToolResult,
} from "../src/types.js";

/**
 * Every test runs against a stubbed JSON-RPC upstream
 * implementing the streamable-HTTP session flow
 * (initialize -> notifications/initialized -> tools/call):
 * no live network, no live call — the real HasData
 * endpoint is never contacted.
 */

const FIXTURE_URL = new URL(
  "../../../harness/fixtures/hasdata-google-maps-tools-original.json",
  import.meta.url,
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_URL);
const fixture = (
  FIXTURE_AVAILABLE
    ? JSON.parse(readFileSync(FIXTURE_URL, "utf-8"))
    : { tools: [] }
) as {
  tools: ToolDef[];
};
/**
 * Publish-survival guard (Wave 25 preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}


const SEARCH = "hasdata_google_maps_search_performMapSearch";
const DETAILS = "hasdata_google_maps_place_getPlaceDetails";
const REVIEWS = "hasdata_google_maps_reviews_getMapReviews";
const PHOTOS = "hasdata_google_maps_photos_getMapPhotos";
const POSTS = "hasdata_google_maps_posts_getMapPosts";
const CONTRIBUTOR = "hasdata_google_maps_contributor_reviews_getMapReviews";

const SAMPLE_RESULT = {
  content: [{ type: "text", text: "{\"places\":[],\"count\":0}" }],
  structuredContent: { count: 0 },
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface FakeOptions {
  callResult?: Record<string, unknown>;
  callBodyText?: string;
  callError?: Record<string, unknown>;
  callStatus?: number;
  initError?: Record<string, unknown>;
  throwOn?: "initialize" | "tools/call";
  sessionId?: string | null;
  hangOnCall?: boolean;
  sse?: boolean;
}

function makeResponse(
  status: number,
  bodyText: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const lowered = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => bodyText,
  };
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return makeResponse(status, JSON.stringify(payload), headers);
}

function makeUpstream(options: FakeOptions = {}): {
  fetchFn: FetchFn;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (options.throwOn === method) throw new Error("socket hang up");
    if (method === "initialize") {
      if (options.initError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.initError,
        });
      }
      const headers: Record<string, string> = {};
      const sessionId =
        options.sessionId === undefined ? "sess-abc" : options.sessionId;
      if (sessionId !== null) headers["mcp-session-id"] = sessionId;
      return jsonResponse(
        200,
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "hasdata-google-maps", version: "1.0.7" },
          },
        },
        headers,
      );
    }
    if (method === "notifications/initialized") {
      return makeResponse(202, "");
    }
    if (method === "tools/call") {
      if (options.hangOnCall) {
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      if (options.callBodyText !== undefined) {
        return makeResponse(options.callStatus ?? 200, options.callBodyText);
      }
      if (options.callError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.callError,
        });
      }
      const result = options.callResult ?? SAMPLE_RESULT;
      const payload = { jsonrpc: "2.0", id: body.id, result };
      if (options.sse) {
        return makeResponse(
          200,
          `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      }
      return jsonResponse(options.callStatus ?? 200, payload);
    }
    return jsonResponse(200, {});
  };
  return { fetchFn, calls };
}

function stubClient(options: FakeOptions = {}, extra: Record<string, unknown> = {}) {
  const upstream = makeUpstream(options);
  const c = new MapsdataClient({
    fetchFn: upstream.fetchFn,
    env: {},
    ...extra,
  });
  return { client: c, calls: upstream.calls };
}

function textOf(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

function methods(calls: Captured[]): string[] {
  return calls.map((c) => c.body.method as string);
}

/* ------------------------------------------------------------------ */

describe("registration integrity (captured surface)", () => {
  it("serves exactly the fixture's 6 tools, deep-equal, in order", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.equal(fixture.tools.length, 6);
    assert.deepEqual(TOOL_DEFS, fixture.tools);
  });

  it("serves the 6 tool names in fixture order", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.deepEqual(TOOL_NAMES, [
      CONTRIBUTOR,
      PHOTOS,
      DETAILS,
      POSTS,
      REVIEWS,
      SEARCH,
    ]);
    assert.deepEqual(TOOL_NAMES, fixture.tools.map((t) => t.name));
  });

  it("each tool carries exactly the fixture's keys", (t) => {
    if (skipWithoutFixture(t)) return;
    for (let i = 0; i < fixture.tools.length; i++) {
      assert.deepEqual(
        Object.keys(TOOL_DEFS[i]).sort(),
        Object.keys(fixture.tools[i]).sort(),
      );
      assert.deepEqual(Object.keys(TOOL_DEFS[i]).sort(), [
        "description",
        "inputSchema",
        "name",
        "title",
      ]);
    }
  });

  it("carries the captured title on every tool", () => {
    assert.deepEqual(
      TOOL_DEFS.map((t) => t.title),
      [
        "google_maps_contributor_reviews: GET /",
        "google_maps_photos: GET /",
        "google_maps_place: GET /",
        "google_maps_posts: GET /",
        "google_maps_reviews: GET /",
        "google_maps_search: GET /",
      ],
    );
  });

  it("carries exactly the fixture's required fields per tool", () => {
    const required = new Map(
      TOOL_DEFS.map((t) => [
        t.name,
        (t.inputSchema as { required?: string[] }).required ?? [],
      ]),
    );
    assert.deepEqual(required.get(CONTRIBUTOR), ["contributorId"]);
    assert.deepEqual(required.get(PHOTOS), []);
    assert.deepEqual(required.get(DETAILS), ["placeId"]);
    assert.deepEqual(required.get(POSTS), []);
    assert.deepEqual(required.get(REVIEWS), []);
    assert.deepEqual(required.get(SEARCH), ["q"]);
  });

  it("carries every fixture property, in order, per tool", (t) => {
    if (skipWithoutFixture(t)) return;
    for (let i = 0; i < fixture.tools.length; i++) {
      const served = Object.keys(
        (TOOL_DEFS[i].inputSchema as { properties: object }).properties,
      );
      const expected = Object.keys(
        (fixture.tools[i].inputSchema as { properties: object }).properties,
      );
      assert.deepEqual(served, expected);
    }
    const propsOf = (name: string) =>
      Object.keys(
        (
          TOOL_DEFS.find((t) => t.name === name)!.inputSchema as {
            properties: object;
          }
        ).properties,
      );
    assert.deepEqual(propsOf(SEARCH), ["q", "domain", "gl", "hl", "start", "ll"]);
    assert.deepEqual(propsOf(REVIEWS), [
      "dataId",
      "placeId",
      "hl",
      "sortBy",
      "topicId",
      "nextPageToken",
    ]);
    assert.deepEqual(propsOf(CONTRIBUTOR), [
      "contributorId",
      "hl",
      "gl",
      "num",
      "nextPageToken",
    ]);
  });

  it("pins the version and the endpoint, query string included", () => {
    assert.equal(VERSION, "0.1.0");
    assert.equal(
      DEFAULT_ENDPOINT_URL,
      "https://mcp.hasdata.com/mcp?apis=google_maps",
    );
  });
});

/* ------------------------------------------------------------------ */

describe("session establishment and reuse", () => {
  it("runs initialize, notifications/initialized, then tools/call in order", async () => {
    const { client: c, calls } = stubClient();
    const out = await c.callTool(SEARCH, { q: "coffee near Union Square" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    assert.ok(calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));

    const initParams = calls[0].body.params as Record<string, unknown>;
    assert.equal(initParams.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(initParams.capabilities, {});
    assert.deepEqual(initParams.clientInfo, {
      name: "mapsdata",
      version: VERSION,
    });
    assert.equal(calls[0].headers["Mcp-Session-Id"], undefined);
    for (const call of calls) {
      assert.equal(call.headers["Content-Type"], "application/json");
      assert.equal(
        call.headers["Accept"],
        "application/json, text/event-stream",
      );
    }
    assert.equal(calls[1].headers["Mcp-Session-Id"], "sess-abc");
    assert.equal(calls[2].headers["Mcp-Session-Id"], "sess-abc");
  });

  it("establishes the session lazily once and reuses it on later calls", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SEARCH, { q: "pizza" });
    await c.callTool(DETAILS, { placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" });
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
    assert.equal(calls[3].headers["Mcp-Session-Id"], "sess-abc");
    assert.notEqual(calls[2].body.id, calls[3].body.id);
  });

  it("sends no session header when the upstream issues none", async () => {
    const { client: c, calls } = stubClient({ sessionId: null });
    const out = await c.callTool(SEARCH, { q: "pizza" });
    assert.equal(out.isError, undefined);
    assert.ok(calls.every((call) => call.headers["Mcp-Session-Id"] === undefined));
  });

  it("honours the HASDATA_GOOGLE_MAPS_MCP_URL env override", async () => {
    const upstream = makeUpstream();
    const c = new MapsdataClient({
      fetchFn: upstream.fetchFn,
      env: {
        HASDATA_GOOGLE_MAPS_MCP_URL:
          "https://staging.example.com/mcp?apis=google_maps",
      },
    });
    await c.callTool(SEARCH, { q: "pizza" });
    assert.ok(
      upstream.calls.every(
        (call) => call.url === "https://staging.example.com/mcp?apis=google_maps",
      ),
    );
  });

  it("honours an explicit url override over the env and the default", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: { HASDATA_GOOGLE_MAPS_MCP_URL: "https://env.example.com/mcp" },
      url: "https://alt.example.com/mcp",
    });
    await c.callTool(SEARCH, { q: "pizza" });
    assert.ok(
      upstream.calls.every((call) => call.url === "https://alt.example.com/mcp"),
    );
  });
});

/* ------------------------------------------------------------------ */

describe("upstream key header", () => {
  it("sends x-api-key: <key> on every request when HASDATA_API_KEY is set", async () => {
    const upstream = makeUpstream();
    const c = new MapsdataClient({
      fetchFn: upstream.fetchFn,
      env: { HASDATA_API_KEY: "hasdata-key-42" },
    });
    await c.callTool(SEARCH, { q: "pizza" });
    assert.equal(upstream.calls.length, 3);
    assert.ok(
      upstream.calls.every(
        (call) => call.headers["x-api-key"] === "hasdata-key-42",
      ),
    );
  });

  it("sends no x-api-key header when HASDATA_API_KEY is unset", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SEARCH, { q: "pizza" });
    assert.ok(calls.every((call) => call.headers["x-api-key"] === undefined));
  });

  it("never sends an Authorization header, with or without a key", async () => {
    const withKey = makeUpstream();
    const c1 = new MapsdataClient({
      fetchFn: withKey.fetchFn,
      env: { HASDATA_API_KEY: "hasdata-key-42" },
    });
    await c1.callTool(SEARCH, { q: "pizza" });
    assert.ok(
      withKey.calls.every((call) => call.headers["Authorization"] === undefined),
    );
    const { client: c2, calls } = stubClient();
    await c2.callTool(SEARCH, { q: "pizza" });
    assert.ok(calls.every((call) => call.headers["Authorization"] === undefined));
  });
});

/* ------------------------------------------------------------------ */

describe("tools/call forwarding", () => {
  it("forwards map-search arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = {
      q: "coffee near Union Square",
      hl: "en",
      gl: "us",
      ll: "@37.788,-122.407,14z",
      start: 20,
    };
    await c.callTool(SEARCH, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, SEARCH);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards place-details arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = {
      placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
      hl: "en",
      fetchWebResults: true,
    };
    await c.callTool(DETAILS, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, DETAILS);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards place-reviews arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = {
      placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
      sortBy: "newestFirst",
      nextPageToken: "tok-3",
    };
    await c.callTool(REVIEWS, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, REVIEWS);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards place-photos arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { dataId: "0x8085809b7b1a2c3d:0x1", categoryId: "food" };
    await c.callTool(PHOTOS, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, PHOTOS);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards map-posts arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4", hl: "en" };
    await c.callTool(POSTS, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, POSTS);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards contributor-reviews arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { contributorId: "109876543210", num: 50, hl: "en" };
    await c.callTool(CONTRIBUTOR, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, CONTRIBUTOR);
    assert.deepEqual(params.arguments, args);
  });

  it("passes the upstream result through verbatim, including extra fields", async () => {
    const { client: c } = stubClient();
    const out = await c.callTool(SEARCH, { q: "pizza" });
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("passes an upstream isError result through untouched", async () => {
    const upstreamResult = {
      content: [{ type: "text", text: "place not found" }],
      isError: true,
    };
    const { client: c } = stubClient({ callResult: upstreamResult });
    const out = await c.callTool(DETAILS, { placeId: "nope" });
    assert.deepEqual(out, upstreamResult);
  });

  it("reads an SSE-framed tools/call response", async () => {
    const { client: c } = stubClient({ sse: true });
    const out = await c.callTool(DETAILS, {
      placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    });
    assert.equal(out.isError, undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("the one-shot callTool helper forwards under the right tool name", async () => {
    const upstream = makeUpstream();
    const out = await callTool(
      REVIEWS,
      { placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" },
      { fetchFn: upstream.fetchFn, env: {} },
    );
    assert.equal(out.isError, undefined);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, REVIEWS);
    assert.deepEqual(params.arguments, {
      placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    });
  });
});

/* ------------------------------------------------------------------ */

describe("upstream failures surface as mapsdata error text", () => {
  it("maps a JSON-RPC error to `mapsdata error: <message>`", async () => {
    const { client: c } = stubClient({
      callError: { code: -32000, message: "place not found" },
    });
    const out = await c.callTool(DETAILS, { placeId: "nope" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "mapsdata error: place not found");
  });

  it("maps an initialize JSON-RPC error to mapsdata error text", async () => {
    const { client: c } = stubClient({
      initError: { code: -32600, message: "bad initialize" },
    });
    const out = await c.callTool(SEARCH, { q: "pizza" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "mapsdata error: bad initialize");
  });

  it("maps an unparseable upstream response to a malformed-response error", async () => {
    const { client: c } = stubClient({ callBodyText: "<html>oops</html>" });
    const out = await c.callTool(SEARCH, { q: "pizza" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "mapsdata error: malformed response");
  });

  it("maps a non-2xx upstream status to mapsdata error text", async () => {
    const { client: c } = stubClient({
      callBodyText: "internal error",
      callStatus: 500,
    });
    const out = await c.callTool(SEARCH, { q: "pizza" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "mapsdata error: HTTP 500");
  });

  it("maps a throwing fetch to mapsdata error text", async () => {
    const { client: c } = stubClient({ throwOn: "tools/call" });
    const out = await c.callTool(SEARCH, { q: "pizza" });
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^mapsdata error: /);
  });

  it("maps a throwing initialize fetch to mapsdata error text", async () => {
    const { client: c } = stubClient({ throwOn: "initialize" });
    const out = await c.callTool(SEARCH, { q: "pizza" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "mapsdata error: socket hang up");
  });

  it("maps a timed-out call to mapsdata error text", async () => {
    const { client: c } = stubClient({ hangOnCall: true }, { timeoutMs: 20 });
    const out = await c.callTool(SEARCH, { q: "pizza" });
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^mapsdata error: /);
  });
});

/* ------------------------------------------------------------------ */

describe("parseRpcBody", () => {
  it("parses plain JSON and picks the message with the matching id", () => {
    const body = '{"jsonrpc":"2.0","id":7,"result":{"ok":true}}';
    assert.deepEqual(parseRpcBody(body, 7), {
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });

  it("parses SSE data lines", () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });

  it("picks the matching id among several SSE messages, else the last", () => {
    const body =
      'data: {"jsonrpc":"2.0","id":1,"result":{"n":1}}\n\n' +
      'data: {"jsonrpc":"2.0","id":2,"result":{"n":2}}\n\n';
    assert.deepEqual(parseRpcBody(body, 1), {
      jsonrpc: "2.0",
      id: 1,
      result: { n: 1 },
    });
    assert.deepEqual(parseRpcBody(body, 99), {
      jsonrpc: "2.0",
      id: 2,
      result: { n: 2 },
    });
  });

  it("returns null for empty and unparseable bodies", () => {
    assert.equal(parseRpcBody(""), null);
    assert.equal(parseRpcBody("not json at all"), null);
  });
});

/* ------------------------------------------------------------------ */

describe("MCP layer validation", () => {
  it("rejects an unknown tool with MethodNotFound before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "not_a_tool", {}),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.MethodNotFound,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects array arguments with InvalidParams before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, SEARCH, ["nope"]),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects string arguments with InvalidParams before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, SEARCH, "q=pizza"),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("forwards a valid call through the MCP layer unchanged", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, DETAILS, {
      placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    });
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, {
      placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    });
  });

  it("treats omitted arguments as an empty object", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, PHOTOS, undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, {});
  });
});

/* ------------------------------------------------------------------ */

describe("CLI", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

  function runCli(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  }

  it("--version prints 0.1.0 and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("-v prints 0.1.0 and exits 0", () => {
    const res = runCli(["-v"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("an unknown command prints usage on stderr and exits 2", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("a non-JSON argument exits 2", () => {
    const res = runCli([SEARCH, "not json"]);
    assert.equal(res.status, 2);
  });

  it("a JSON array argument exits 2", () => {
    const res = runCli([SEARCH, "[]"]);
    assert.equal(res.status, 2);
  });
});
