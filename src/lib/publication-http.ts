import type { JWTVerifyGetKey } from "jose";
import { AdminAuthError, readAdminConfig, requireAdmin } from "./admin-auth.ts";
import { readAdminJson } from "./upload-http.ts";
import { MediaValidationError, mediaSlots } from "./media.ts";
import { publishPlacement } from "./publish-placement.ts";
import { UploadError } from "./uploads.ts";
import { requireWriteAllowance } from "./admin-write-limit.ts";

export async function handlePublication(request: Request, env: Record<string, string | undefined>,
  services: () => Promise<{ storage: Parameters<typeof publishPlacement>[0]; client: Parameters<typeof publishPlacement>[1] }>, keys?: JWTVerifyGetKey) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  try {
    const identity = await requireAdmin(request, readAdminConfig(env), keys);
    if (request.method !== "POST") throw new UploadError(405, "请求方法无效。");
    if (env.PUBLICATION_ENABLED !== "true") throw new UploadError(503, "公开发布尚未启用，请等待首次发布确认与验收。");
    const body = await readAdminJson(request) as Record<string, unknown>;
    const revision = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 256 && !/\s/.test(value);
    if (!body || typeof body !== "object" || Array.isArray(body) || body.confirmed !== true ||
      Object.keys(body).some(key => !["slotId", "revision", "previousRevision", "confirmed"].includes(key)) ||
      !mediaSlots.some(slot => slot.id === body.slotId) || !revision(body.revision) ||
      (body.previousRevision !== null && !revision(body.previousRevision))) throw new UploadError(400, "请确认有效的预览版本后再发布。");
    const { storage, client } = await services();
    await requireWriteAllowance(storage.UPLOADS, identity.subject, "publication");
    const result = await publishPlacement(storage, client, identity.subject, body.slotId, body.revision, body.previousRevision);
    return Response.json({ published: true, transactionId: result.transactionId }, { headers });
  } catch (error) {
    const expected = error instanceof AdminAuthError || error instanceof UploadError;
    const conflict = error instanceof Error && "statusCode" in error && error.statusCode === 409;
    return Response.json({ error: expected || error instanceof MediaValidationError ? error.message : conflict
      ? "版本已变化，未自动覆盖。请重新预览。" : "发布未确认。请核对当前公开版本，不要直接重复提交。" }, {
      status: expected ? error.status : error instanceof MediaValidationError ? 400 : conflict ? 409 : 503,
      headers: { ...headers, ...(error instanceof UploadError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) },
    });
  }
}
