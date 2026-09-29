import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";

test("admin authentication verifies signatures, claims, allowlist and write origin", async () => {
  const implementation = await import("../src/lib/admin-auth.ts").catch(() => ({}));
  assert.equal(typeof implementation.requireAdmin, "function", "shared admin verifier must exist");
  const { requireAdmin, readAdminConfig } = implementation;
  const env = {
    ACCESS_ISSUER: "https://portfolio-test.cloudflareaccess.com",
    ACCESS_AUDIENCE: "test-application-audience",
    ADMIN_EMAILS: "owner@example.test",
    ADMIN_ORIGIN: "https://portfolio.example.test",
  };
  const config = readAdminConfig(env);
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test", alg: "RS256" }] });
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: "owner-id", email: "owner@example.test", iss: env.ACCESS_ISSUER, aud: env.ACCESS_AUDIENCE, iat: now, exp: now + 300 };
  const sign = (changes = {}, key = privateKey) => new SignJWT({ ...claims, ...changes }).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(key);
  const request = (token, method = "GET", origin) => new Request(`${env.ADMIN_ORIGIN}/api/admin/session`, {
    method, headers: { ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}), ...(origin ? { origin } : {}) },
  });
  const rejected = (req, status) => assert.rejects(requireAdmin(req, config, keys), error => error.status === status);
  const valid = await sign();
  assert.deepEqual(await requireAdmin(request(valid), config, keys), { subject: "owner-id", email: "owner@example.test" });
  await rejected(request(), 401);
  await rejected(new Request(`${env.ADMIN_ORIGIN}/api/admin/session`, { headers: { "Cf-Access-Authenticated-User-Email": claims.email } }), 401);
  await rejected(request("not-a-jwt"), 401);
  const wrongKeys = await generateKeyPair("RS256");
  await rejected(request(await sign({}, wrongKeys.privateKey)), 401);
  for (const changes of [{ exp: now - 10 }, { exp: undefined }, { sub: undefined }, { sub: "" }, { sub: 123 }, { iat: undefined }, { iat: now + 600 }, { nbf: now + 600 }, { iss: "https://attacker.example" }, { aud: "other-application" }]) {
    await rejected(request(await sign(changes)), 401);
  }
  await rejected(request(await sign({ email: "someone@example.test" })), 403);
  await rejected(request(await sign({ email: undefined })), 403);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    await rejected(request(valid, method), 403);
    await rejected(request(valid, method, "https://attacker.example"), 403);
    assert.equal((await requireAdmin(request(valid, method, env.ADMIN_ORIGIN), config, keys)).subject, "owner-id");
  }
  for (const invalid of [{}, { ...env, ADMIN_EMAILS: "" }, { ...env, ACCESS_ISSUER: "https://attacker.example" }, { ...env, ACCESS_AUDIENCE: "" }, { ...env, ADMIN_ORIGIN: "https://portfolio.example.test/extra" }]) {
    assert.throws(() => readAdminConfig(invalid), error => error.status === 503);
  }
});
