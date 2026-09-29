import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export class AdminAuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type AdminConfig = {
  issuer: string;
  audience: string;
  emails: string[];
  origin: string;
};

export function readAdminConfig(env: Record<string, string | undefined>): AdminConfig {
  const issuer = env.ACCESS_ISSUER?.trim() || "";
  const audience = env.ACCESS_AUDIENCE?.trim() || "";
  const emails = (env.ADMIN_EMAILS || "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
  const origin = env.ADMIN_ORIGIN?.trim() || "";
  let validOrigin = false;
  try {
    const url = new URL(origin);
    validOrigin = url.origin === origin && url.protocol === "https:" && !url.username && !url.password;
  } catch { /* Missing or invalid configuration must fail closed. */ }
  if (!/^https:\/\/[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(issuer) ||
    !audience || !emails.length || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || !validOrigin) {
    throw new AdminAuthError(503, "管理身份服务尚未配置。");
  }
  return { issuer, audience, emails, origin };
}

let remoteKeys: { issuer: string; resolve: JWTVerifyGetKey } | undefined;
function keysFor(issuer: string) {
  if (remoteKeys?.issuer !== issuer) {
    remoteKeys = { issuer, resolve: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 }) };
  }
  return remoteKeys.resolve;
}

export async function requireAdmin(request: Request, config: AdminConfig, keys?: JWTVerifyGetKey) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16384) throw new AdminAuthError(401, "请先登录管理后台。");
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keys ?? keysFor(config.issuer), {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub", "iss", "aud"],
    }));
  } catch {
    throw new AdminAuthError(401, "登录身份无效或已过期，请重新登录。");
  }
  if (typeof payload.sub !== "string" || !payload.sub.trim() ||
    typeof payload.iat !== "number" || payload.iat > Math.floor(Date.now() / 1000) + 60) {
    throw new AdminAuthError(401, "登录身份无效或已过期，请重新登录。");
  }
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email || !config.emails.includes(email)) throw new AdminAuthError(403, "此账号没有管理权限。");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    (request.headers.get("origin") !== config.origin || request.headers.get("sec-fetch-site") === "cross-site")) {
    throw new AdminAuthError(403, "请求来源不被允许。");
  }
  return { subject: payload.sub, email };
}
