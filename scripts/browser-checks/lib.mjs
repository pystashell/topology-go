import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
const COLS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"; export function label(row, col, height) { return `${COLS[col] ?? String(col + 1)}${height - row}`; }

// Override with BASE=http://localhost:8787 (wrangler dev) and SHOTS=<dir>.
export const BASE = process.env.BASE ?? "http://localhost:8787";
export const SHOTS = process.env.SHOTS ?? join(tmpdir(), "topology-go-browser-checks");
mkdirSync(SHOTS, { recursive: true });

export const problems = [];

export async function launch() {
  return chromium.launch({
    // Uses Playwright's own Chromium unless CHROMIUM_PATH points elsewhere.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
}

/** A page that records console errors, page errors and CSP violations. */
export async function openPage(browser, { locale = "zh-CN", viewport = { width: 1400, height: 900 }, name = "page", context = null } = {}) {
  const ctx = context ?? await browser.newContext({ viewport, deviceScaleFactor: 1 });
  if (!context) {
    await ctx.addInitScript((value) => {
      try { localStorage.setItem("3d-baduk-locale-v1", value); } catch {}
    }, locale);
  }
  const page = await ctx.newPage();
  page.__name = name;
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" || /Content Security Policy|Refused to/u.test(text)) {
      problems.push(`[${name}] console.${message.type()}: ${text}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`[${name}] pageerror: ${error.message}`));
  return { page, context: ctx };
}

export async function shot(page, file) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${file}.png` });
  return `${SHOTS}/${file}.png`;
}

export async function text(page, selector) {
  return (await page.locator(selector).first().textContent())?.trim() ?? "";
}

/**
 * Hover the visible board in-page and map each coordinate label to a screen
 * point: the sample whose neighbourhood most agrees on that label (robust on
 * twisted 3D surfaces where a point's screen region is not convex).
 */
export async function scanBoard(page, { step = 4 } = {}) {
  return page.evaluate((stepPx) => {
    const surface = [...document.querySelectorAll(".view-surface")].find((node) => !node.hidden);
    const canvas = surface?.querySelector("canvas");
    if (!canvas) return {};
    const rect = canvas.getBoundingClientRect();
    const hint = document.querySelector("#coordinate-hint");
    const xs = [];
    const ys = [];
    for (let x = rect.left + 2; x < rect.right - 2; x += stepPx) xs.push(x);
    for (let y = rect.top + 2; y < rect.bottom - 2; y += stepPx) ys.push(y);
    const grid = ys.map((y) => xs.map((x) => {
      canvas.dispatchEvent(new PointerEvent("pointermove", {
        clientX: x, clientY: y, bubbles: true, pointerId: 1, pointerType: "mouse", isPrimary: true,
      }));
      const labelText = (hint.textContent || "").split(" · ")[0].trim();
      return /^[A-Z]{1,2}\d{1,2}$/u.test(labelText) ? labelText : "";
    }));
    canvas.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true, pointerId: 1 }));
    const best = {};
    const radius = 2;
    for (let i = 0; i < ys.length; i += 1) {
      for (let j = 0; j < xs.length; j += 1) {
        const key = grid[i][j];
        if (!key) continue;
        let score = 0;
        for (let di = -radius; di <= radius; di += 1) {
          for (let dj = -radius; dj <= radius; dj += 1) {
            if (grid[i + di]?.[j + dj] === key) score += 1;
          }
        }
        if (!best[key] || score > best[key].score) best[key] = { x: xs[j], y: ys[i], score };
      }
    }
    return best;
  }, step);
}

export async function clickPoint(page, map, row, col, height) {
  const key = label(row, col, height);
  const point = map[key];
  if (!point) throw new Error(`point ${key} is not visible`);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(60);
  return key;
}

export async function setView(page, mode) {
  await page.click(`.view-switch [data-view-mode="${mode}"]`);
  await page.waitForTimeout(400);
}

export async function openSettings(page) {
  await page.click('[data-sidebar-tab="settings"]');
}

/** Configure the local board in the settings panel. */
export async function configureBoard(page, { gameType, ruleSet, topology, width, height }) {
  await openSettings(page);
  await page.click(`#game-type-field [data-game-type="${gameType}"]`);
  if (ruleSet) await page.selectOption("#gomoku-rule", ruleSet);
  if (topology) await page.click(`.settings [data-board-topology="${topology}"]`);
  if (width) {
    await page.fill("#custom-width", String(width));
    await page.press("#custom-width", "Enter");
  }
  if (height) {
    await page.fill("#custom-height", String(height));
    await page.press("#custom-height", "Enter");
  }
  await page.waitForTimeout(200);
}

export async function startLocalGame(page) {
  await page.click("[data-open-invite]");
  await page.waitForSelector("#invite-dialog[open]");
  await page.click("#invite-local");
  await page.waitForTimeout(300);
}

export function report(title, details) {
  console.log(`\n=== ${title}`);
  for (const line of details) console.log(`  ${line}`);
}

/** Visible text nodes that still contain Chinese on an English page. */
export async function cjkLeftovers(page) {
  return page.evaluate(() => {
    const cjk = /[㐀-鿿！-｠　-〿]/u;
    const found = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue.trim();
      if (!value || !cjk.test(value) || value === "中文") continue;
      const element = node.parentElement;
      if (!element || element.closest("[data-i18n-ignore], script, style")) continue;
      let hidden = false;
      for (let current = element; current; current = current.parentElement) {
        if (current.hidden || getComputedStyle(current).display === "none") { hidden = true; break; }
      }
      if (!hidden) found.add(value);
    }
    for (const element of document.querySelectorAll("[aria-label], [title], [placeholder]")) {
      for (const attribute of ["aria-label", "title", "placeholder"]) {
        const value = element.getAttribute(attribute);
        if (value && cjk.test(value)) found.add(`@${attribute}: ${value}`);
      }
    }
    return [...found];
  });
}
