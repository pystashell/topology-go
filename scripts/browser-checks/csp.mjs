// Drives the built app under its real _headers CSP (served by wrangler dev)
// and fails on any CSP violation in the page or its KataGo worker.
import http from "node:http";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:8787";
const REPORT_PORT = Number(process.env.REPORT_PORT ?? 8796);
const reports = [];
const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    if (body) reports.push(body);
    response.writeHead(204, { "Access-Control-Allow-Origin": "*" });
    response.end();
  });
}).listen(REPORT_PORT);

const console_ = [];
const violations = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1400, height: 900 } });
await context.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", (event) => {
    console.error(`CSP-VIOLATION ${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`);
  });
});
const page = await context.newPage();
page.on("console", (message) => {
  const text = message.text();
  if (["error", "warning"].includes(message.type()) || /CSP|Content Security Policy|Refused/u.test(text)) {
    console_.push(`[${message.type()}] ${text}`);
  }
  if (/CSP-VIOLATION|Content Security Policy|Refused to/u.test(text)) violations.push(text);
});
page.on("pageerror", (error) => console_.push(`[pageerror] ${error.message}`));
const workers = [];
page.on("worker", (worker) => workers.push(worker.url()));
const sockets = [];
page.on("websocket", (socket) => {
  const entry = { url: socket.url(), received: [] };
  sockets.push(entry);
  socket.on("framereceived", ({ payload }) => {
    try { entry.received.push(JSON.parse(payload).type); } catch { entry.received.push("?"); }
  });
});
const step = (name) => console.log(`- ${name}`);

step("load app");
const response = await page.goto(`${BASE}/`, { waitUntil: "load" });
console.log("  CSP header:", response.headers()["content-security-policy"]);
await page.waitForTimeout(1_000);

step("switch flat / 3D / arc views");
for (const mode of ["flat", "3d", "arc"]) {
  await page.click(`[data-view-mode="${mode}"]`);
  await page.waitForTimeout(800);
}

step("start a local AI self-play game (b10)");
await page.click("[data-open-invite] >> visible=true");
await page.click("#invite-self-play");
await page.selectOption("#ai-model", "b10");
if (await page.isVisible("#ai-black-model")) await page.selectOption("#ai-black-model", "b10");
await page.click("#start-ai");
await page.waitForFunction(() => /第\s*([3-9]|\d{2,})\s*手/u.test(
  document.querySelector("#move-number")?.textContent ?? "",
), null, { timeout: 240_000 });
console.log("  after AI moves:", await page.textContent("#move-number"), "|", await page.textContent("#message"));
console.log("  workers:", workers);

step("open the lobby");
await page.goto(`${BASE}/lobby`, { waitUntil: "load" });
await page.waitForFunction(() => !/正在读取/u.test(document.querySelector("#lobby-status")?.textContent ?? "正在读取"), null, { timeout: 30_000 });
console.log("  lobby status:", await page.textContent("#lobby-status"));

step("create a room and connect over WebSocket");
await page.click("#lobby-create-room");
await page.fill("#player-name", "CSP 检查");
await page.click("#create-room");
await page.waitForFunction(() => location.pathname.length > 1 && !/lobby/u.test(location.pathname), null, { timeout: 30_000 }).catch(() => {});
const deadline = Date.now() + 20_000;
while (Date.now() < deadline && !sockets.some(({ received }) => received.includes("state"))) {
  await page.waitForTimeout(250);
}
console.log("  url:", page.url(), "sockets:", JSON.stringify(sockets.map(({ url, received }) => ({ url, received: received.slice(0, 4) }))));
await page.waitForTimeout(1_500);

await browser.close();
await new Promise((resolve) => setTimeout(resolve, 500));
server.close();
console.log("\nconsole errors/warnings:", console_.length ? `\n  ${console_.join("\n  ")}` : "none");
console.log("CSP reports:", reports.length ? `\n  ${reports.join("\n  ")}` : "none");
console.log("violation events:", violations.length);
const connected = sockets.some(({ received }) => received.includes("state"));
if (!connected) console.log("WebSocket state not received!");
process.exit(reports.length || violations.length || !connected ? 1 : 0);
