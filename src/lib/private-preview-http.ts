import type { JWTVerifyGetKey } from "jose";
import { AdminAuthError, readAdminConfig, requireAdmin } from "./admin-auth.ts";
import { readPrivateVariant } from "./private-preview.ts";
import type { UploadStorage } from "./upload-http.ts";
import { UploadError } from "./uploads.ts";

export async function handlePrivatePreview(request: Request, env: Record<string, string | undefined>, storage: () => Promise<UploadStorage>, keys?: JWTVerifyGetKey) {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" });
  try {
    const identity = await requireAdmin(request, readAdminConfig(env), keys);
    if (request.method !== "GET") throw new UploadError(405, "请求方法无效。");
    const params = new URL(request.url).searchParams;
    const assetId = params.get("assetId") || "";
    const role = params.get("role") || "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(assetId) ||
      !["thumbnail", "detail", "poster", "video", "model"].includes(role) ||
      [...params.keys()].some(key => !["assetId", "role"].includes(key)) ||
      params.getAll("assetId").length !== 1 || params.getAll("role").length !== 1) {
      throw new UploadError(400, "预览参数无效。");
    }
    const { UPLOADS, ORIGINALS } = await storage();
    const { object, mimeType, range } = await readPrivateVariant(UPLOADS, ORIGINALS, identity.subject, assetId, role, request.headers.get("range"));
    headers.set("Content-Type", mimeType);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Length", String(range?.length ?? object.size));
    if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
    return new Response(object.body as ReadableStream, { status: range ? 206 : 200, headers });
  } catch (error) {
    const expected = error instanceof AdminAuthError || error instanceof UploadError;
    return Response.json({ error: expected ? error.message : "预览暂时不可用。" }, { status: expected ? error.status : 503, headers });
  }
}
