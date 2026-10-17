import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

const origin = "https://baduk.test";
const paths = ["/api/rooms", "/api/rooms/BAM234/join"];

for (const path of paths) {
  test(`${path} returns a Response for malformed JSON`, async () => {
    const response = await worker.fetch(new Request(origin + path, {
      method: "POST", body: "{",
    }), {});
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /JSON/);
  });

  test(`${path} stops and cancels a chunked body after the byte limit`, async () => {
    let reads = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(1024).fill(32));
        if (reads === 2048) controller.close();
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const response = await worker.fetch(new Request(origin + path, {
      method: "POST", body, duplex: "half",
    }), {});
    assert.equal(response.status, 413);
    assert.equal(reads, 5);
    assert.equal(cancelled, true);
  });
}

test("a false Content-Length cannot bypass the streaming limit", async () => {
  const response = await worker.fetch(new Request(origin + "/api/rooms", {
    method: "POST", headers: { "Content-Length": "1" }, body: " ".repeat(4097),
  }), {});
  assert.equal(response.status, 413);
});

test("the limit counts UTF-8 bytes and preserves split multibyte input", async () => {
  for (const bytes of [4096, 4097]) {
    const text = JSON.stringify({ name: "围棋" });
    const encoded = new TextEncoder().encode(text);
    const chunks = [...encoded, ...new Uint8Array(bytes - encoded.length).fill(32)];
    const response = await worker.fetch(new Request(origin + "/api/rooms", {
      method: "POST", duplex: "half",
      body: new ReadableStream({
        start(controller) {
          for (const byte of chunks) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }),
    }), {});
    assert.equal(response.status, bytes === 4096 ? 400 : 413);
    if (bytes === 4096) assert.match((await response.json()).error, /协议版本/);
  }
});

test("all async forwarding branches use the shared HTTP error response", async (t) => {
  t.mock.method(console, "error", () => {});
  const fail = async () => { throw new Error("upstream unavailable"); };
  const env = {
    BADUK_ROOMS: { getByName: () => ({ fetch: fail }) },
    BADUK_ROOM_INDEX: { getByName: () => ({ fetch: fail }) },
    ASSETS: { fetch: fail },
  };
  for (const path of ["/api/lobby", "/api/rooms/BAM234/ws", "/"]) {
    assert.equal((await worker.fetch(new Request(origin + path), env)).status, 500);
  }
});

test("rate-limited routes return 429 before reaching a Durable Object", async () => {
  const keys = [];
  const deny = { async limit({ key }) { keys.push(key); return { success: false }; } };
  const untouched = { getByName() { throw new Error("must not reach a Durable Object"); } };
  const env = {
    BADUK_ROOMS: untouched,
    BADUK_ROOM_INDEX: untouched,
    ROOM_CREATE_RATE_LIMITER: deny,
    ROOM_JOIN_RATE_LIMITER: deny,
    ROOM_SOCKET_RATE_LIMITER: deny,
    LOBBY_RATE_LIMITER: deny,
  };
  const requests = [
    new Request(origin + "/api/rooms", { method: "POST", body: "{}" }),
    new Request(origin + "/api/rooms/BAM234/join", { method: "POST", body: "{}" }),
    new Request(origin + "/api/rooms/BAM234/socket", { headers: { Upgrade: "websocket" } }),
    new Request(origin + "/api/lobby"),
  ];
  for (const request of requests) {
    request.headers.set("CF-Connecting-IP", "203.0.113.7");
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "60");
    const body = await response.json();
    assert.equal(body.code, "RATE_LIMITED");
    assert.equal(body.retryable, true);
    assert.equal(typeof body.error, "string");
  }
  assert.deepEqual(keys, Array(4).fill("203.0.113.7"));
});

test("each route spends only its own limiter and a broken limiter fails open", async (t) => {
  t.mock.method(console, "error", () => {});
  const spent = [];
  const limiter = (name, outcome) => ({
    async limit() {
      spent.push(name);
      if (outcome instanceof Error) throw outcome;
      return { success: outcome };
    },
  });
  const env = {
    BADUK_ROOM_INDEX: {
      getByName: () => ({ fetch: async () => Response.json({ rooms: [] }) }),
    },
    ROOM_CREATE_RATE_LIMITER: limiter("create", false),
    LOBBY_RATE_LIMITER: limiter("lobby", new Error("binding unavailable")),
  };
  const response = await worker.fetch(new Request(origin + "/api/lobby"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rooms: [] });
  assert.deepEqual(spent, ["lobby"]);
});
