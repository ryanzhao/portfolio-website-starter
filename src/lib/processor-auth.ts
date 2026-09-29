import { timingSafeEqual } from "node:crypto";
import { AdminAuthError } from "./admin-auth.ts";

// Dedicated machine credential, never an administrator-session replacement.
// Provision 32 random bytes as hex in server secrets and private PC configuration.
export function requireProcessor(request: Request, env: Record<string, string | undefined>) {
  const secret = env.PROCESSOR_TOKEN;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) throw new AdminAuthError(503, "本地处理程序身份尚未配置。");
  if (request.headers.has("origin") || request.headers.has("sec-fetch-site")) {
    throw new AdminAuthError(403, "此接口不接受浏览器请求。");
  }
  const credential = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!credential || !timingSafeEqual(Buffer.from(credential, "hex"), Buffer.from(secret, "hex"))) {
    throw new AdminAuthError(401, "处理程序身份无效。");
  }
}
