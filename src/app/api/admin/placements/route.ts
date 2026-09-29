import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AdminAuthError, readAdminConfig, requireAdmin } from "@/lib/admin-auth";
import { contentClient } from "@/lib/content-client";
import { MediaValidationError } from "@/lib/media";
import { readPlacementDraft, savePlacementDraft } from "@/lib/placement-draft";
import { readAdminJson, type UploadStorage } from "@/lib/upload-http";
import { UploadError, readUpload } from "@/lib/uploads";
import { readPublishedPlacement } from "@/lib/published-placement";
import { requireWriteAllowance } from "@/lib/admin-write-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const identity = await requireAdmin(request, readAdminConfig(process.env));
    const slotId = new URL(request.url).searchParams.get("slotId");
    const client = contentClient(process.env);
    const draft = await readPlacementDraft(client, slotId);
    const published = draft.placement ? null : (await readPublishedPlacement(client, slotId))?.placement ?? null;
    const placement = draft.placement ?? published;
    if (placement) {
      const { env } = await getCloudflareContext({ async: true });
      const { UPLOADS } = env as unknown as UploadStorage;
      await readUpload(UPLOADS, identity.subject, placement.assetId);
    }
    return Response.json({ ...draft, published }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof AdminAuthError || error instanceof UploadError || error instanceof MediaValidationError
      ? error.message : "无法读取草稿，请稍后重试。" }, {
      status: error instanceof AdminAuthError || error instanceof UploadError ? error.status : error instanceof MediaValidationError ? 400 : 503,
      headers,
    });
  }
}

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const identity = await requireAdmin(request, readAdminConfig(process.env));
    const body = await readAdminJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      !("placement" in body) || !("revision" in body) ||
      Object.keys(body).some(key => key !== "placement" && key !== "revision")) {
      throw new UploadError(400, "草稿请求字段无效。");
    }
    const client = contentClient(process.env);
    const { env } = await getCloudflareContext({ async: true });
    const { UPLOADS } = env as unknown as UploadStorage;
    if (!UPLOADS) throw new UploadError(503, "素材记录服务尚未配置。");
    await requireWriteAllowance(UPLOADS, identity.subject, "drafts");
    await savePlacementDraft(UPLOADS, client, identity.subject, body.placement, body.revision);
    return Response.json({ saved: true, published: false }, { headers });
  } catch (error) {
    const expected = error instanceof AdminAuthError || error instanceof UploadError;
    const conflict = error instanceof Error && "statusCode" in error && error.statusCode === 409;
    return Response.json({ error: expected || error instanceof MediaValidationError ? error.message
      : conflict ? "草稿版本已变化，请刷新后重新确认；未自动覆盖。" : "草稿服务暂时不可用，请稍后重试。" }, {
      status: expected ? error.status : error instanceof MediaValidationError ? 400 : conflict ? 409 : 503,
      headers: { ...headers, ...(error instanceof UploadError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) },
    });
  }
}
