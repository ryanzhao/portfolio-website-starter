import type { D1Database, R2Bucket, R2UploadedPart } from "@cloudflare/workers-types";
import { MediaValidationError, validateUpload } from "./media.ts";
import { inspectPrivateObject } from "./media-inspection.ts";

export const uploadPartSize = 8 * 1024 * 1024;
type Upload = ReturnType<typeof validateUpload> & {
  id: string; owner: string; objectKey: string; uploadId: string | null;
  status: "uploading" | "completing" | "processing_pending" | "rejected" | "cancelling" | "cancelled";
  createdAt: number; expiresAt: number;
  completionParts: string | null; storageVersion: string | null; storageEtag: string | null;
};

export class UploadError extends Error {
  status: number;
  retryAfter?: number;
  constructor(status: number, message: string) { super(message); this.name = "UploadError"; this.status = status; }
}

function checkIdentity(owner: string, id: string) {
  if (!owner || owner.length > 256 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new UploadError(400, "上传标识无效。");
  }
}

// owner must come from verified Access subject, never the request body.
export async function readUpload(db: D1Database, owner: string, id: string): Promise<Upload> {
  checkIdentity(owner, id);
  const upload = await db.prepare("SELECT * FROM upload_sessions WHERE id = ? AND owner = ?").bind(id, owner).first<Upload>();
  if (!upload) throw new UploadError(404, "上传会话不存在。");
  return upload;
}

export function uploadPartRange(upload: Upload, partNumber: unknown) {
  if (upload.status !== "uploading" || !upload.uploadId || upload.expiresAt <= Date.now()) throw new UploadError(409, "上传已结束或过期。");
  if (typeof partNumber !== "number" || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > Math.ceil(upload.size / uploadPartSize)) {
    throw new UploadError(400, "分片编号无效。");
  }
  const offset = (partNumber - 1) * uploadPartSize;
  return { offset, length: Math.min(uploadPartSize, upload.size - offset) };
}

export async function beginUpload(db: D1Database, bucket: R2Bucket, owner: string, id: string, value: unknown, quotaBytes: number) {
  checkIdentity(owner, id);
  const file = validateUpload(value);
  if (!Number.isSafeInteger(quotaBytes) || quotaBytes <= 0) throw new UploadError(503, "上传额度尚未配置。");
  const now = Date.now();
  // One statement reserves quota atomically. Completed/rejected originals still
  // occupy quota; expiry alone never pretends bytes were removed from storage.
  // ponytail: SUM scans session rows; use a transactional counter if volume grows.
  await db.prepare(`INSERT INTO upload_sessions
    (id, owner, filename, mimeType, size, kind, objectKey, status, createdAt, expiresAt)
    SELECT ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?
    WHERE COALESCE((SELECT SUM(size) FROM upload_sessions WHERE status != 'cancelled'), 0)
      + COALESCE((SELECT SUM(size) FROM designer_fonts), 0) + ? <= ?
    AND (SELECT COUNT(*) FROM upload_sessions WHERE owner = ? AND status IN ('uploading', 'completing', 'cancelling')) < 8
    ON CONFLICT(id) DO NOTHING`).bind(id, owner, file.filename, file.mimeType, file.size, file.kind,
      `originals/${id}`, now, now + 24 * 60 * 60 * 1000, file.size, quotaBytes, owner).run();
  const existing = await db.prepare("SELECT owner FROM upload_sessions WHERE id = ?").bind(id).first<{ owner: string }>();
  if (!existing) throw new UploadError(413, "存储额度不足或同时上传任务过多，请先取消不需要的任务。");
  let upload = await readUpload(db, owner, id);
  if (upload.filename !== file.filename || upload.mimeType !== file.mimeType || upload.size !== file.size) {
    throw new UploadError(409, "同一上传标识不能用于不同文件。");
  }
  if (upload.status !== "uploading" || upload.expiresAt <= now) throw new UploadError(409, "此上传已结束或过期，请使用新的上传标识。");
  if (upload.uploadId) return upload;
  const multipart = await bucket.createMultipartUpload(upload.objectKey, { httpMetadata: { contentType: file.mimeType } });
  // Simultaneous retries can create empty multiparts; only the persisted winner
  // can be returned to a client. Losers are aborted, never given upload authority.
  // Do not abort on an uncertain DB outcome: it may have committed. A retry
  // resolves stored state; empty unreferenced multiparts expire by R2 lifecycle.
  const assigned = await db.prepare("UPDATE upload_sessions SET uploadId = ? WHERE id = ? AND owner = ? AND status = 'uploading' AND uploadId IS NULL")
    .bind(multipart.uploadId, id, owner).run();
  if (!assigned.meta.changes) await multipart.abort();
  upload = await readUpload(db, owner, id);
  if (upload.status !== "uploading" || !upload.uploadId) throw new UploadError(409, "上传状态已改变，请刷新。");
  return upload;
}

export async function cancelUpload(db: D1Database, bucket: R2Bucket, owner: string, id: string) {
  let upload = await readUpload(db, owner, id);
  if (upload.status === "cancelled") return upload;
  await db.prepare("UPDATE upload_sessions SET status = 'cancelling' WHERE id = ? AND owner = ? AND status IN ('uploading', 'completing')").bind(id, owner).run();
  upload = await readUpload(db, owner, id);
  if (upload.status === "cancelled") return upload;
  if (upload.status !== "cancelling") throw new UploadError(409, "文件正在完成或已保存，不能作为未完成上传取消。");
  if (upload.uploadId) await bucket.resumeMultipartUpload(upload.objectKey, upload.uploadId).abort();
  // Abort first closes the multipart, then HEAD resolves an uncertain completion.
  // A completed original is never deleted and its reservation is not released.
  if (await bucket.head(upload.objectKey)) {
    await db.prepare("UPDATE upload_sessions SET status = 'completing' WHERE id = ? AND owner = ? AND status = 'cancelling'").bind(id, owner).run();
    throw new UploadError(409, "原文件已保存，请重试完成校验；取消不会删除原文件。");
  }
  await db.prepare("UPDATE upload_sessions SET status = 'cancelled' WHERE id = ? AND owner = ? AND status = 'cancelling'").bind(id, owner).run();
  return readUpload(db, owner, id);
}

export async function recoverUpload(db: D1Database, bucket: R2Bucket, owner: string, id: string) {
  const upload = await readUpload(db, owner, id);
  if (upload.status === "processing_pending") return upload;
  if (upload.status !== "completing" || !upload.completionParts) throw new UploadError(409, "此任务没有待恢复的完成校验。");
  // Only reuse the locked server manifest; never accept replacement receipts here.
  return completeUpload(db, bucket, owner, id, JSON.parse(upload.completionParts));
}

export async function completeUpload(db: D1Database, bucket: R2Bucket, owner: string, id: string, input: unknown) {
  let upload = await readUpload(db, owner, id);
  if (!Array.isArray(input) || input.length !== Math.ceil(upload.size / uploadPartSize)) throw new UploadError(400, "分片清单不完整。");
  const parts: R2UploadedPart[] = input.map((part, i) => {
    if (!part || typeof part !== "object" || Array.isArray(part) ||
      Object.keys(part).some(key => !["partNumber", "etag"].includes(key)) ||
      part.partNumber !== i + 1 || typeof part.etag !== "string" ||
      !part.etag.length || part.etag.length > 256 || /[\x00-\x20\x7f]/.test(part.etag)) {
      throw new UploadError(400, "分片编号或校验标识无效。");
    }
    return { partNumber: part.partNumber, etag: part.etag };
  });
  const manifest = JSON.stringify(parts);
  if (upload.status === "uploading") {
    if (!upload.uploadId || upload.expiresAt <= Date.now()) throw new UploadError(409, "上传未初始化或已过期。");
    await db.prepare("UPDATE upload_sessions SET status = 'completing', completionParts = ? WHERE id = ? AND owner = ? AND status = 'uploading'")
      .bind(manifest, id, owner).run();
    upload = await readUpload(db, owner, id);
  }
  if (upload.completionParts !== manifest) throw new UploadError(409, "上传完成清单已锁定，请勿更换分片。");
  if (upload.status === "processing_pending") return upload;
  if (upload.status !== "completing" || !upload.uploadId) throw new UploadError(409, "当前状态不能完成上传。");
  // R2 can commit even if its response or the subsequent D1 update is lost.
  // Never abort/delete an uncertain completion; inspect the private object on retry.
  if (!await bucket.head(upload.objectKey)) {
    try {
      // S3 HTTP receipts quote the ETag; the Workers binding expects its raw value.
      // Keep the stored manifest unchanged so already-started completions can retry.
      await bucket.resumeMultipartUpload(upload.objectKey, upload.uploadId).complete(
        parts.map(part => ({ ...part, etag: part.etag.replace(/^"([^"\\]+)"$/, "$1") })),
      );
    } catch (error) {
      if (!await bucket.head(upload.objectKey)) throw error;
    }
  }
  let verified;
  try {
    verified = await inspectPrivateObject(bucket, upload.objectKey, {
      filename: upload.filename, mimeType: upload.mimeType, size: upload.size,
    });
  } catch (error) {
    if (error instanceof MediaValidationError) {
      await db.prepare("UPDATE upload_sessions SET status = 'rejected' WHERE id = ? AND owner = ? AND status = 'completing'").bind(id, owner).run();
    }
    throw error;
  }
  await db.prepare("UPDATE upload_sessions SET status = 'processing_pending', storageVersion = ?, storageEtag = ? WHERE id = ? AND owner = ? AND status = 'completing'")
    .bind(verified.storageVersion, verified.storageEtag, id, owner).run();
  const saved = await readUpload(db, owner, id);
  if (saved.status !== "processing_pending") throw new UploadError(409, "素材校验状态发生变化，请刷新。");
  return saved;
}
