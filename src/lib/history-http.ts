import type { JWTVerifyGetKey } from "jose";
import { AdminAuthError, readAdminConfig, requireAdmin } from "./admin-auth.ts";
import { readAdminJson } from "./upload-http.ts";
import { mediaSlots, MediaValidationError } from "./media.ts";
import { readPlacementHistory, restorePlacementDraft, validateRecoveryInput } from "./placement-recovery.ts";
import { UploadError } from "./uploads.ts";
import { requireWriteAllowance } from "./admin-write-limit.ts";

export async function handleHistory(request: Request, env: Record<string, string | undefined>,
  services: () => Promise<{ storage: Parameters<typeof restorePlacementDraft>[0]; client: Parameters<typeof restorePlacementDraft>[1] }>, keys?: JWTVerifyGetKey) {
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  try {
    const identity = await requireAdmin(request, readAdminConfig(env), keys);
    if (request.method === "GET") {
      const query = new URL(request.url).searchParams;
      const slotId = query.get("slotId"), cursor = query.get("cursor") ?? undefined, id = query.get("snapshotId") ?? undefined;
      if (!mediaSlots.some(slot => slot.id === slotId) || [...query.keys()].some(key => !["slotId", "cursor", "snapshotId"].includes(key)) ||
        (id !== undefined && !/^[a-f0-9]{64}$/.test(id)) || (cursor !== undefined && (cursor.length > 2048 || /[\x00-\x20\x7f]/.test(cursor)))) throw new UploadError(400, "历史查询无效。");
      const { storage, client } = await services();
      return Response.json(await readPlacementHistory(storage, client, identity.subject, slotId, cursor, id), { headers });
    }
    if (request.method !== "POST") throw new UploadError(405, "请求方法无效。");
    const body = validateRecoveryInput(await readAdminJson(request));
    const { storage, client } = await services();
    await requireWriteAllowance(storage.UPLOADS, identity.subject, "publication");
    return Response.json(await restorePlacementDraft(storage, client, identity.subject, body), { headers });
  } catch (error) {
    const expected = error instanceof AdminAuthError || error instanceof UploadError;
    return Response.json({ error: expected || error instanceof MediaValidationError ? error.message : "历史操作未确认，请重新读取草稿核对，勿盲目重复恢复。" }, {
      status: expected ? error.status : error instanceof MediaValidationError ? 400 : 503,
      headers: { ...headers, ...(error instanceof UploadError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) },
    });
  }
}
