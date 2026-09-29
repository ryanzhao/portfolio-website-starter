import { test } from "node:test";
import assert from "node:assert/strict";

test("Studio configuration is explicit and exposes no server credential", async () => {
  const config = await import("../src/lib/studio-config.ts");
  assert.equal(config.readStudioConfig({}), null);
  assert.equal(config.readStudioConfig({ SANITY_PROJECT_ID: "invalid/id", SANITY_DATASET: "production" }), null);
  assert.equal(config.readStudioConfig({ SANITY_PROJECT_ID: "abc123xy", SANITY_DATASET: "../private" }), null);
  assert.deepEqual(config.readStudioConfig({ SANITY_PROJECT_ID: "abc123xy", SANITY_DATASET: "preview", SANITY_API_TOKEN: "must-not-leak" }), { projectId: "abc123xy", dataset: "preview" });
});

test("Studio schemas cover content and placements without native Sanity file uploads", async () => {
  const { schemaTypes } = await import("../src/sanity/schema.ts");
  const { Schema } = await import("@sanity/schema");
  const compiled = Schema.compile({ name: "portfolio", types: schemaTypes });
  assert.ok(compiled.get("mediaPlacement"), "schemas compile with Sanity's own compiler");
  const names = schemaTypes.map(s => s.name);
  for (const name of ["siteSettings", "project", "update", "about", "mediaAsset", "mediaPlacement"]) assert.ok(names.includes(name), name);
  assert.equal(new Set(names).size, names.length);
  const placement = schemaTypes.find(s => s.name === "mediaPlacement");
  assert.equal(placement.fields.find(f => f.name === "slotId").options.list.length, 24);
  const scan = value => {
    if (!value || typeof value !== "object") return;
    if ("type" in value) assert.ok(!["image", "file"].includes(value.type), "all media must use R2 references, not Sanity public asset uploads");
    Object.values(value).forEach(scan);
  };
  schemaTypes.forEach(scan);
});

test("Studio CSP allowances are scoped to the configured project and admin route", async () => {
  const originalProject = process.env.SANITY_PROJECT_ID;
  const originalDataset = process.env.SANITY_DATASET;
  try {
    const { default: config } = await import("../next.config.ts");
    delete process.env.SANITY_PROJECT_ID;
    delete process.env.SANITY_DATASET;
    const unconfigured = await config.headers();
    assert.ok(!JSON.stringify(unconfigured).includes("https://api.sanity.io"));
    process.env.SANITY_PROJECT_ID = "abc123xy";
    process.env.SANITY_DATASET = "preview";
    const configured = await config.headers();
    assert.ok(!JSON.stringify(configured[0]).includes("api.sanity.io"));
    const studio = configured.find(entry => entry.source === "/admin/studio/:path*");
    const policy = studio.headers.find(header => header.key === "Content-Security-Policy").value;
    assert.ok(policy.includes("https://abc123xy.api.sanity.io"));
    assert.ok(policy.includes("https://design-system-static.sanity.io"));
    assert.ok(!policy.includes("*.sanity.io"));
  } finally {
    if (originalProject === undefined) delete process.env.SANITY_PROJECT_ID;
    else process.env.SANITY_PROJECT_ID = originalProject;
    if (originalDataset === undefined) delete process.env.SANITY_DATASET;
    else process.env.SANITY_DATASET = originalDataset;
  }
});
