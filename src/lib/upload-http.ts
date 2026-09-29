import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { JWTVerifyGetKey } from "jose";
import { AdminAuthError, readAdminConfig, requireAdmin } from "./admin-auth.ts";
import { MediaValidationError } from "./media.ts";
import { beginUpload, cancelUpload, completeUpload, recoverUpload, readUpload, UploadError } from "./uploads.ts";
import { signUploadPart } from "./upload-signing.ts";
import { prepareUploadResume, acknowledgeUploadPart } from "./upload-resume.ts";
import { requireWriteAllowance } from "./admin-write-limit.ts";

export type UploadStorage = { UPLOADS: D1Database; ORIGINALS: R2Bucket };

// Control messages only. Media bytes must go directly to R2, not this endpoint.
export async function readAdminJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new UploadError(415, "请使用 JSON 请求。");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new UploadError(400, "请求内容为空。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 131072) {
        await reader.cancel();
        throw new UploadError(413, "上传控制请求过大。");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new UploadError(400, "JSON 格式无效。"); }
  return body;
}

async function readControl(request: Request): Promise<Record<string, unknown> & { action: string; id: string }> {
  const body = await readAdminJson(request) as Record<string, unknown>;
  const fields: Record<string, string[]> = { begin: ["action", "id", "file"], read: ["action", "id"],
    cancel: ["action", "id"], complete: ["action", "id", "parts"], part: ["action", "id", "partNumber"],
    prepare: ["action", "id", "hashes"], receipt: ["action", "id", "partNumber", "etag"], recover: ["action", "id"] };
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new UploadError(400, "上传请求字段无效。");
  const { action, id } = body;
  if (typeof action !== "string" || !Object.hasOwn(fields, action) ||
    Object.keys(body).some(key => !fields[action].includes(key)) || typeof id !== "string") {
    throw new UploadError(400, "上传请求字段无效。");
  }
  return { ...body, action, id };
}

export async function handleUploadRequest(request: Request, env: Record<string, string | undefined>,
  storage: () => Promise<UploadStorage>, keys?: JWTVerifyGetKey) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const identity = await requireAdmin(request, readAdminConfig(env), keys);
    if (request.method === "GET") {
      const offsetText = new URL(request.url).searchParams.get("offset") ?? "0";
      if (!/^\d{1,7}$/.test(offsetText)) throw new UploadError(400, "素材列表页码无效。");
      const offset = Number(offsetText);
      const { UPLOADS: db } = await storage();
      if (!db) throw new UploadError(503, "素材记录服务尚未配置。");
      // ponytail: offset pagination can shift under new uploads; refresh returns newest first.
      const result = await db.prepare(`SELECT u.id, u.filename, u.mimeType, u.size, u.kind, u.status, u.createdAt, u.expiresAt,
        j.status AS processingStatus FROM upload_sessions u LEFT JOIN processing_jobs j ON j.assetId = u.id
        WHERE u.owner = ? ORDER BY u.createdAt DESC, u.id DESC LIMIT 51 OFFSET ?`)
        .bind(identity.subject, offset).all();
      const totalBytes=Number(env.UPLOAD_QUOTA_BYTES),used=await db.prepare(`SELECT COALESCE((SELECT SUM(size) FROM upload_sessions WHERE status != 'cancelled'),0) + COALESCE((SELECT SUM(size) FROM designer_fonts),0) AS bytes`).first<{bytes:number}>();
      const quota=Number.isSafeInteger(totalBytes)&&totalBytes>0?{totalBytes,usedBytes:used?.bytes??0,remainingBytes:Math.max(0,totalBytes-(used?.bytes??0))}:null;
      return Response.json({ items: result.results.slice(0, 50), nextOffset: result.results.length > 50 ? offset + 50 : null, quota }, { headers });
    }
    if (request.method !== "POST") throw new UploadError(405, "不支持此请求方法。");
    const body = await readControl(request);
    const { UPLOADS: db, ORIGINALS: bucket } = await storage();
    if (!db || !bucket) throw new UploadError(503, "上传存储尚未配置。");
    await requireWriteAllowance(db, identity.subject, "uploads");
    if (body.action === "prepare") {
      return Response.json({ parts: await prepareUploadResume(db, identity.subject, body.id, body.hashes) }, { headers });
    }
    if (body.action === "receipt") {
      await acknowledgeUploadPart(db, identity.subject, body.id, body.partNumber, body.etag);
      return Response.json({ saved: true }, { headers });
    }
    if (body.action === "part") {
      const upload = await readUpload(db, identity.subject, body.id);
      return Response.json(await signUploadPart(upload, body.partNumber, env), { headers });
    }
    const upload = body.action === "begin" ? await beginUpload(db, bucket, identity.subject, body.id, body.file, Number(env.UPLOAD_QUOTA_BYTES))
      : body.action === "cancel" ? await cancelUpload(db, bucket, identity.subject, body.id)
      : body.action === "complete" ? await completeUpload(db, bucket, identity.subject, body.id, body.parts)
      : body.action === "recover" ? await recoverUpload(db, bucket, identity.subject, body.id)
      : await readUpload(db, identity.subject, body.id);
    // Never expose private object keys, owner IDs or stored multipart credentials.
    return Response.json({ id: upload.id, filename: upload.filename, mimeType: upload.mimeType,
      size: upload.size, kind: upload.kind, status: upload.status, expiresAt: upload.expiresAt }, { headers });
  } catch (error) {
    const expected = error instanceof AdminAuthError || error instanceof UploadError;
    return Response.json({ error: expected || error instanceof MediaValidationError ? error.message : "上传服务暂时不可用，请稍后重试。" }, {
      status: expected ? error.status : error instanceof MediaValidationError ? 400 : 503,
      headers: { ...headers, ...(error instanceof UploadError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) },
    });
  }
}
