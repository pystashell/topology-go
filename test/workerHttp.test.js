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
