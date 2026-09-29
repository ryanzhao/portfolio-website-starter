import assert from "node:assert/strict";
import { mediaSlots } from "../src/lib/media.ts";
const base = process.env.SMOKE_URL || "http://127.0.0.1:8787";
const pages = ["/", "/projects", "/projects/apes", "/about", "/updates", "/contact", "/admin", "/admin/advanced", "/model-preview", ...["advanced-rockets-engines", "chemistry-propellant", "electronics", "education-outreach", "teamworks"].map(slug => `/work/${slug}`)];
const renderedSlots = new Set();
for (const path of pages) {
  const response = await fetch(new URL(path, base));
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get("x-robots-tag") || "", /noindex/, path);
  const html = await response.text();
  assert.match(html, /Ryan|RYAN/, path);
  for (const match of html.matchAll(/data-media-slot="([^"]+)"/g)) renderedSlots.add(match[1]);
}
assert.deepEqual([...renderedSlots].sort(), mediaSlots.map(slot => slot.id).sort(), "admin media catalog must match rendered page slots");
for (const path of ["/projects/unknown", "/updates/unpublished", "/does-not-exist", "/work/unknown"]) {
  assert.equal((await fetch(new URL(path, base))).status, 404, path);
}
for (const path of ["/api/admin/design", "/api/admin/design/fonts", "/api/admin/layout", "/api/admin/library", "/api/admin/session", "/api/admin/slots", "/api/admin/history?slotId=home.hero", "/api/admin/placements?slotId=home.hero", "/api/admin/media?assetId=test&role=detail"]) {
  const response = await fetch(new URL(path, base));
  assert.ok([401, 503].includes(response.status), `${path}: anonymous access must fail closed`);
  assert.equal(response.headers.get("cache-control"), "no-store");
}
const health = await fetch(new URL("/api/health", base));
const upload = await fetch(new URL("/api/admin/uploads", base), {
  method: "POST", headers: { "content-type": "application/json", origin: base },
  body: JSON.stringify({ action: "begin", id: crypto.randomUUID(), file: { filename: "test.png", mimeType: "image/png", size: 68 } }),
});
assert.ok([401, 503].includes(upload.status), "anonymous upload must fail closed");
assert.equal(upload.headers.get("cache-control"), "no-store");
const placement = await fetch(new URL("/api/admin/placements", base), {
  method: "POST", headers: { "content-type": "application/json", origin: base }, body: "{}",
});
assert.ok([401, 503].includes(placement.status), "anonymous draft writes must fail closed");
assert.equal(placement.headers.get("cache-control"), "no-store");
for (const path of ["/api/admin/design", "/api/admin/design/fonts", "/api/admin/layout", "/api/admin/library", "/api/admin/publish", "/api/admin/history", "/api/processor"]) {
  const response = await fetch(new URL(path, base), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.ok([401, 503].includes(response.status), `${path}: anonymous access must fail closed`);
  assert.equal(response.headers.get("cache-control"), "no-store");
}
const preview = await fetch(new URL("/admin/preview?path=/", base));
assert.equal(preview.status, 200);
assert.match(preview.headers.get("cache-control") || "", /no-store/);
assert.match(await preview.text(), /无法打开私有预览/);
const publicMedia = await fetch(new URL("/api/media?key=originals/private", base));
assert.equal(publicMedia.status, 404);
assert.match(publicMedia.headers.get("cache-control") || "", /(?:^|,\s*)no-store(?:,|$)/);
assert.equal((await health.json()).status, "ok");
assert.equal(health.headers.get("cache-control"), "no-store");
console.log(`PASS: ${pages.length} pages, 4 real 404s, preview noindex headers, dynamic health route.`);
