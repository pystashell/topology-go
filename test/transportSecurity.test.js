import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import worker from "../worker/index.js";
import {
  DOCUMENT_SECURITY_HEADERS,
  HSTS,
  httpsRedirect,
  isLocalHost,
  secureResponse,
} from "../worker/transportSecurity.js";

/*
 * HTTPS on every address the Worker answers: plain http (the workers.dev
 * address has no edge redirect) goes to https, https answers carry HSTS,
 * and pages the Worker hands on keep the document security headers.
 */

const WORKERS_DEV = "topology-go.pystashell.workers.dev";

function headersRule(path) {
  const lines = readFileSync(new URL("../public/_headers", import.meta.url), "utf8").split(/\r?\n/u);
  const rule = {};
  let inside = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("/")) {
      inside = line === path;
      continue;
    }
    if (!inside || line.startsWith("!")) continue;
    const separator = line.indexOf(":");
    rule[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return rule;
}

const lower = (headers) => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));

test("the Worker's page headers are exactly the static assets' rule, HSTS included", () => {
  assert.deepEqual(lower(DOCUMENT_SECURITY_HEADERS), headersRule("/*"));
  assert.equal(headersRule("/*")["strict-transport-security"], HSTS);
  assert.match(HSTS, /^max-age=31536000$/u, "a year, no includeSubDomains or preload");
});

test("plain http goes to the same address over https; local development stays on http", () => {
  const page = httpsRedirect(new Request(`http://${WORKERS_DEV}/online/ABC234?role=player`));
  assert.equal(page.status, 301);
  assert.equal(page.headers.get("Location"), `https://${WORKERS_DEV}/online/ABC234?role=player`);
  const head = httpsRedirect(new Request(`http://${WORKERS_DEV}/`, { method: "HEAD" }));
  assert.equal(head.status, 301);
  // A command keeps its method and body through the redirect.
  const post = httpsRedirect(new Request(`http://${WORKERS_DEV}/api/rooms`, { method: "POST", body: "{}" }));
  assert.equal(post.status, 308);
  assert.equal(post.headers.get("Location"), `https://${WORKERS_DEV}/api/rooms`);
  assert.equal(httpsRedirect(new Request(`https://${WORKERS_DEV}/`)), null);
  for (const host of ["localhost:8787", "127.0.0.1:8787", "[::1]:8787", "app.localhost"]) {
    assert.equal(httpsRedirect(new Request(`http://${host}/single`)), null, host);
  }
  assert.ok(isLocalHost("localhost") && !isLocalHost("localhost.example.com") && !isLocalHost(WORKERS_DEV));
});

test("the Worker redirects before doing anything else", async () => {
  let assetsCalled = false;
  const env = { ASSETS: { fetch: () => { assetsCalled = true; return new Response("page"); } } };
  const page = await worker.fetch(new Request(`http://${WORKERS_DEV}/lobby`), env);
  assert.equal(page.status, 301);
  assert.equal(page.headers.get("Location"), `https://${WORKERS_DEV}/lobby`);
  const api = await worker.fetch(new Request(`http://game.example/api/rooms`, { method: "POST", body: "{}" }), env);
  assert.equal(api.status, 308);
  assert.equal(assetsCalled, false);
});

test("https answers carry HSTS: API JSON, and pages with their document headers", async () => {
  const api = await worker.fetch(new Request("https://baduk.test/api/rooms/health"), {});
  assert.equal(api.headers.get("Strict-Transport-Security"), HSTS);
  assert.match(api.headers.get("Content-Type"), /application\/json/u);
  assert.equal(api.headers.get("Content-Security-Policy"), null, "JSON needs no page policy");

  // A page from the assets binding without the _headers rules gets them all.
  const bare = { ASSETS: { fetch: () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }) } };
  const page = await worker.fetch(new Request("https://baduk.test/online/ABC234"), bare);
  for (const [name, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
    assert.equal(page.headers.get(name), value, name);
  }
  assert.equal(await page.text(), "<!doctype html>");

  // A page that already has them keeps its own (nothing is doubled).
  const own = { ASSETS: { fetch: () => new Response("<p>", { headers: {
    "Content-Type": "text/html", "Content-Security-Policy": "default-src 'none'", "Strict-Transport-Security": "max-age=5",
  } }) } };
  const kept = await worker.fetch(new Request("https://baduk.test/single"), own);
  assert.equal(kept.headers.get("Content-Security-Policy"), "default-src 'none'");
  assert.equal(kept.headers.get("Strict-Transport-Security"), "max-age=5");
  assert.equal(kept.headers.get("X-Frame-Options"), "DENY", "a missing one is still added");
});

test("local http pages keep their security headers but get no HSTS", async () => {
  const env = { ASSETS: { fetch: () => new Response("<html>", { headers: { "Content-Type": "text/html" } }) } };
  const page = await worker.fetch(new Request("http://localhost:8787/single"), env);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("Strict-Transport-Security"), null);
  assert.equal(page.headers.get("Content-Security-Policy"), DOCUMENT_SECURITY_HEADERS["Content-Security-Policy"]);
});

test("WebSocket upgrades and finished responses pass through untouched", () => {
  const upgrade = { status: 101, headers: new Headers() };
  assert.equal(secureResponse(new Request("https://baduk.test/api/rooms/ABC234/socket"), upgrade), upgrade);
  const done = new Response("{}", { headers: { "Content-Type": "application/json", "Strict-Transport-Security": HSTS } });
  assert.equal(secureResponse(new Request("https://baduk.test/api/lobby"), done), done);
});

test("every page path reaches the Worker first; every static file and folder skips it", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gmu, ""));
  const patterns = config.assets.run_worker_first;
  assert.ok(patterns.includes("/*"), "pages and the API run the Worker first");
  const skipped = new Set(patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1)));
  const entries = readdirSync(new URL("../public/", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.name !== "_headers");
  for (const entry of entries) {
    const pattern = entry.isDirectory() ? `/${entry.name}/*` : `/${entry.name}`;
    assert.ok(skipped.has(pattern), `public/${entry.name} should skip the Worker: add "!${pattern}"`);
  }
  // Vite's build output folder too.
  assert.ok(skipped.has("/assets/*"));
  assert.ok(![...skipped].some((pattern) => pattern.startsWith("/api")), "the API always runs the Worker");
});
