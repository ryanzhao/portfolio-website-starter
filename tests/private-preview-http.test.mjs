import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";

test("private preview denies anonymous access without opening storage", async () => {
  const api = await import("../src/lib/private-preview-http.ts").catch(() => ({}));
  assert.equal(typeof api.handlePrivatePreview, "function");
  const env = { ACCESS_ISSUER: "https://test.cloudflareaccess.com", ACCESS_AUDIENCE: "test", ADMIN_EMAILS: "owner@example.test", ADMIN_ORIGIN: "https://admin.example.test" };
  let calls = 0;
  const response = await api.handlePrivatePreview(new Request("https://admin.example.test/api/admin/media?assetId=test&role=detail"), env, async () => { calls++; throw new Error("private"); });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(calls, 0);
});

test("authenticated preview validates parameters and sanitizes storage errors", async () => {
  const { handlePrivatePreview } = await import("../src/lib/private-preview-http.ts");
  const env = { ACCESS_ISSUER: "https://test.cloudflareaccess.com", ACCESS_AUDIENCE: "test", ADMIN_EMAILS: "owner@example.test", ADMIN_ORIGIN: "https://admin.example.test" };
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test", alg: "RS256" }] });
  const token = await new SignJWT({ email: "owner@example.test" }).setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject("owner-id").setIssuer(env.ACCESS_ISSUER).setAudience(env.ACCESS_AUDIENCE).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  let calls = 0;
  const storage = async () => { calls++; throw new Error("secret storage configuration"); };
  const id = "12345678-1234-4123-8123-123456789abc";
  const request = query => new Request(`${env.ADMIN_ORIGIN}/api/admin/media?${query}`, { headers: { "Cf-Access-Jwt-Assertion": token } });
  for (const query of [`assetId=bad&role=detail`, `assetId=${id}&role=original`, `assetId=${id}&role=detail&role=video`, `assetId=${id}&role=detail&key=secret`]) {
    assert.equal((await handlePrivatePreview(request(query), env, storage, keys)).status, 400);
  }
  assert.equal(calls, 0);
  const response = await handlePrivatePreview(request(`assetId=${id}&role=detail`), env, storage, keys);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await response.text()).includes("secret"), false);
  assert.equal(calls, 1);
});
