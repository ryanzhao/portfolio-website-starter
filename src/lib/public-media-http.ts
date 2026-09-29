import type { R2Bucket } from "@cloudflare/workers-types";
import { readPublicMedia } from "./public-media.ts";
import { UploadError } from "./uploads.ts";

export async function handlePublicMedia(request: Request, env: Record<string, string | undefined>, storage: () => Promise<R2Bucket>) {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  try {
    // Separate from publishing permission: pausing future writes must not break existing media.
    if (env.PUBLIC_MEDIA_ENABLED !== "true") throw new UploadError(404, "素材不存在。");
    if (!["GET", "HEAD"].includes(request.method)) throw new UploadError(405, "请求方法无效。");
    const params = new URL(request.url).searchParams;
    if (params.getAll("key").length !== 1 || [...params.keys()].some(key => key !== "key")) throw new UploadError(400, "素材参数无效。");
    const { object, range, mimeType } = await readPublicMedia(await storage(), params.get("key")!, request.method === "HEAD" ? null : request.headers.get("range"));
    headers.set("Content-Type", mimeType);
    headers.set("Content-Length", String(range?.length ?? object.size));
    headers.set("Accept-Ranges", "bytes");
    headers.set("ETag", object.httpEtag);
    if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    if (request.method === "HEAD") { await object.body.cancel(); return new Response(null, { headers }); }
    return new Response(object.body as ReadableStream, { status: range ? 206 : 200, headers });
  } catch (error) {
    headers.set("Cache-Control", "no-store");
    const status = error instanceof UploadError ? error.status : 503;
    return new Response(request.method === "HEAD" ? null : JSON.stringify({ error: status === 503 ? "素材暂不可用。" : "无法读取素材。" }), { status, headers });
  }
}
