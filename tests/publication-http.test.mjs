import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";

test("publication endpoint authenticates, checks origin and defaults to disabled before service access", async () => {
  const api = await import("../src/lib/publication-http.ts").catch(() => ({}));
  assert.equal(typeof api.handlePublication, "function");
  const env = { ACCESS_ISSUER: "https://test.cloudflareaccess.com", ACCESS_AUDIENCE: "test", ADMIN_EMAILS: "owner@example.test", ADMIN_ORIGIN: "https://admin.example.test" };
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test", alg: "RS256" }] });
  const token = await new SignJWT({ email: env.ADMIN_EMAILS }).setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject("owner").setIssuer(env.ACCESS_ISSUER).setAudience(env.ACCESS_AUDIENCE).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  let calls = 0;
  const services = async () => { calls++; throw new Error("secret"); };
  const request = (jwt, origin, body = {}) => new Request(`${env.ADMIN_ORIGIN}/api/admin/publish`, { method: "POST", headers: {
    "content-type": "application/json", "Cf-Access-Jwt-Assertion": jwt, origin }, body: JSON.stringify(body) });
  for (const [req, status] of [[request("", env.ADMIN_ORIGIN), 401], [request(token, "https://other.test"), 403], [request(token, env.ADMIN_ORIGIN), 503]]) {
    const response = await api.handlePublication(req, env, services, keys);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
  const enabled = { ...env, PUBLICATION_ENABLED: "true" };
  for (const body of [{}, { slotId: "home.hero", revision: "r1", previousRevision: null, confirmed: false }, { slotId: "home.hero", revision: "r1", previousRevision: null, confirmed: true, owner: "other" }]) {
    assert.equal((await api.handlePublication(request(token, env.ADMIN_ORIGIN, body), enabled, services, keys)).status, 400);
  }
  assert.equal(calls, 0);
});
