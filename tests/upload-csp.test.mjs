import { test } from "node:test";
import assert from "node:assert/strict";

test("upload CSP permits one configured R2 account only on the admin upload page", async () => {
  const { default: config } = await import("../next.config.ts");
  const before = process.env.R2_ACCOUNT_ID;
  try {
    process.env.R2_ACCOUNT_ID = "a".repeat(32);
    let rules = await config.headers();
    const policy = source => rules.find(rule => rule.source === source)?.headers.find(header => header.key === "Content-Security-Policy")?.value;
    assert.ok(policy("/admin"), "admin upload page must have scoped policy");
    assert.match(policy("/admin"), /connect-src[^;]*https:\/\/a{32}\.r2\.cloudflarestorage\.com/);
    for (const page of ["/admin/advanced", "/admin/design"]) assert.equal(policy(page), policy("/admin"), `${page} supports the same authenticated multipart uploads`);
    assert.doesNotMatch(policy("/:path*"), /cloudflarestorage/);
    assert.doesNotMatch(policy("/admin/studio/:path*"), /cloudflarestorage/);
    for (const value of ["", "*", "a".repeat(32) + "; connect-src *"]) {
      process.env.R2_ACCOUNT_ID = value;
      rules = await config.headers();
      assert.doesNotMatch(policy("/admin") || "", /cloudflarestorage|connect-src \*/);
    }
  } finally {
    if (before === undefined) delete process.env.R2_ACCOUNT_ID;
    else process.env.R2_ACCOUNT_ID = before;
  }
});
