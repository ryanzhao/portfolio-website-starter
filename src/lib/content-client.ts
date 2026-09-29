import { createClient } from "@sanity/client";
import { readStudioConfig } from "./studio-config.ts";
import { AdminAuthError } from "./admin-auth.ts";

// Server use only. Never pass this client or its config to a React client component.
export function contentClient(env: Record<string, string | undefined>) {
  if (typeof window !== "undefined") throw new Error("Content credentials are server-only.");
  const connection = readStudioConfig(env);
  const token = env.SANITY_WRITE_TOKEN?.trim();
  if (!connection || !token) throw new AdminAuthError(503, "内容服务写入凭据尚未配置。");
  return createClient({ ...connection, token, apiVersion: "2026-09-19",
    useCdn: false, perspective: "raw", timeout: 15000, maxRetries: 0 });
}
