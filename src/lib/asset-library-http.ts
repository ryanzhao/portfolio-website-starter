import type { D1Database } from "@cloudflare/workers-types";
import type { JWTVerifyGetKey } from "jose";
import { AdminAuthError, readAdminConfig, requireAdmin } from "./admin-auth.ts";
import { listAssets, saveAssetTags } from "./asset-library.ts";
import { requireWriteAllowance } from "./admin-write-limit.ts";
import { readAdminJson } from "./upload-http.ts";
import { UploadError } from "./uploads.ts";
import { retryProcessing } from "./processing.ts";

export async function handleAssetLibrary(request: Request, env: Record<string, string | undefined>,
  database: () => Promise<D1Database>, keys?: JWTVerifyGetKey) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  try {
    const identity = await requireAdmin(request, readAdminConfig(env), keys);
    if (request.method === "GET") {
      const query = new URL(request.url).searchParams;
      const offset = query.get("offset") ?? "0";
      if ([...query.keys()].some(key => !["q", "kind", "tag", "offset"].includes(key) || query.getAll(key).length !== 1) ||
        !/^\d{1,7}$/.test(offset)) throw new UploadError(400, "素材查询无效。");
      return Response.json(await listAssets(await database(), identity.subject, {
        q: query.get("q") ?? undefined, kind: query.get("kind") ?? undefined,
        tag: query.get("tag") ?? undefined, offset: Number(offset),
      }), { headers });
    }
    if (request.method !== "POST") throw new UploadError(405, "请求方法无效。");
    const body = await readAdminJson(request);
    if (body && typeof body === 'object' && !Array.isArray(body) && 'action' in body && body.action === 'retry-processing') {
      if (Object.keys(body).length !== 2 || !('assetId' in body) || typeof body.assetId !== 'string') throw new UploadError(400, '重试请求字段无效。');
      const db = await database();
      await requireWriteAllowance(db, identity.subject, 'drafts');
      return Response.json(await retryProcessing(db, identity.subject, body.assetId), { headers });
    }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== 3 || Object.keys(body).some(key => !["assetId", "tags", "revision"].includes(key)) ||
      !("assetId" in body) || typeof body.assetId !== "string" || !("tags" in body) || !("revision" in body)) {
      throw new UploadError(400, "标签请求字段无效。");
    }
    const db = await database();
    await requireWriteAllowance(db, identity.subject, "drafts");
    return Response.json({ saved: true, ...await saveAssetTags(db, identity.subject, body.assetId, body.tags, body.revision) }, { headers });
  } catch (error) {
    const expected = error instanceof AdminAuthError || error instanceof UploadError;
    return Response.json({ error: expected ? error.message : "素材库服务暂时不可用，请稍后重试。" }, {
      status: expected ? error.status : 503,
      headers: { ...headers, ...(error instanceof UploadError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) },
    });
  }
}
