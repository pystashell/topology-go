import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const publicFile = (path) => new URL(`../public${path}`, import.meta.url);

function pngSize(path) {
  const bytes = readFileSync(publicFile(path));
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", `${path} must be a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function headAttribute(pattern) {
  const match = pattern.exec(html);
  assert.ok(match, `expected ${pattern}`);
  return match[1];
}

test("the page declares a favicon, touch icon and web app manifest that exist", () => {
  const icon = headAttribute(/<link rel="icon" href="([^"]+\.svg)" type="image\/svg\+xml" \/>/u);
  assert.ok(existsSync(publicFile(icon)));
  assert.match(readFileSync(publicFile(icon), "utf8"), /^<svg [^>]*viewBox="0 0 64 64"/u);
  assert.deepEqual(pngSize(headAttribute(/<link rel="apple-touch-icon" href="([^"]+)" \/>/u)), [180, 180]);

  const manifestPath = headAttribute(/<link rel="manifest" href="([^"]+)" \/>/u);
  const manifest = JSON.parse(readFileSync(publicFile(manifestPath), "utf8"));
  assert.equal(manifest.short_name, "3D Baduk");
  assert.equal(manifest.start_url, "/single");
  assert.equal(manifest.display, "standalone");
  for (const entry of manifest.icons) {
    assert.ok(existsSync(publicFile(entry.src)), `${entry.src} must exist`);
    if (entry.type === "image/png") {
      const [width, height] = pngSize(entry.src);
      assert.equal(`${width}x${height}`, entry.sizes, entry.src);
    }
  }
  assert.ok(manifest.icons.some((entry) => entry.purpose === "maskable"));
  assert.ok(manifest.icons.some((entry) => entry.sizes === "512x512"));
});

test("link previews carry a title, description and a 1200x630 image", () => {
  for (const property of ["og:title", "og:description", "og:image", "og:type"]) {
    assert.match(html, new RegExp(`<meta\\s+property="${property}"\\s+content="[^"]+"`, "u"), property);
  }
  for (const name of ["twitter:card", "twitter:title", "twitter:description", "twitter:image"]) {
    assert.match(html, new RegExp(`<meta\\s+name="${name}"\\s+content="[^"]+"`, "u"), name);
  }
  const image = headAttribute(/property="og:image" content="([^"]+)"/u);
  assert.match(image, /^https:\/\/[^/]+\/og-image\.png$/u, "previews need an absolute image URL");
  assert.deepEqual(pngSize(new URL(image).pathname), [1200, 630]);
  assert.equal(headAttribute(/name="twitter:image" content="([^"]+)"/u), image);
});

test("coarse pointers get at least 40 px toolbar, shape and view controls", () => {
  const start = styles.indexOf("@media (pointer: coarse) {");
  assert.ok(start > styles.lastIndexOf("@media (max-width: 560px)"), "must override the phone sizing");
  const block = styles.slice(start, styles.indexOf("@media (prefers-reduced-motion", start));
  for (const selector of [
    ".topology-switch button",
    ".language-switch button",
    ".size-buttons button",
    ".scene-toolbar .icon-button",
    ".view-switch button",
  ]) {
    const index = block.indexOf(selector);
    assert.ok(index >= 0, `${selector} needs a touch size`);
    const height = Number(/min-height: (\d+)px/u.exec(block.slice(index))?.[1]);
    assert.ok(height >= 40, `${selector} min-height ${height}`);
  }
});
