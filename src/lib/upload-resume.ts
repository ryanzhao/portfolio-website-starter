import type { D1Database } from "@cloudflare/workers-types";
import { readUpload, uploadPartRange, uploadPartSize, UploadError } from "./uploads.ts";

// Identity is the hash of every file part, including bytes not yet transferred.
// Receipts are not proof of valid media; R2 completion and media inspection remain mandatory.
export async function prepareUploadResume(db: D1Database, owner: string, id: string, input: unknown) {
  const upload = await readUpload(db, owner, id);
  uploadPartRange(upload, 1);
  if (!Array.isArray(input) || input.length !== Math.ceil(upload.size / uploadPartSize) ||
    input.some(hash => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))) {
    throw new UploadError(400, "文件分片指纹无效。");
  }
  const hashes = JSON.stringify(input);
  await db.prepare(`INSERT INTO upload_resume (assetId, partHashes)
    SELECT id, ? FROM upload_sessions WHERE id = ? AND owner = ? AND status = 'uploading' AND expiresAt > ?
    ON CONFLICT(assetId) DO NOTHING`).bind(hashes, id, owner, Date.now()).run();
  const saved = await db.prepare("SELECT partHashes FROM upload_resume WHERE assetId = ?").bind(id).first<{ partHashes: string }>();
  if (saved?.partHashes !== hashes) throw new UploadError(409, "所选文件内容与原上传不一致，不能续传；请重新选择原文件。");
  const parts = await db.prepare("SELECT partNumber, etag FROM upload_part_receipts WHERE assetId = ? ORDER BY partNumber")
    .bind(id).all<{ partNumber: number; etag: string }>();
  return parts.results;
}

export async function acknowledgeUploadPart(db: D1Database, owner: string, id: string, partNumber: unknown, etag: unknown) {
  const upload = await readUpload(db, owner, id);
  uploadPartRange(upload, partNumber);
  if (typeof etag !== "string" || !etag.length || etag.length > 256 || /[\x00-\x20\x7f]/.test(etag)) {
    throw new UploadError(400, "分片回执无效。");
  }
  await db.prepare(`INSERT INTO upload_part_receipts (assetId, partNumber, etag)
    SELECT u.id, ?, ? FROM upload_sessions u JOIN upload_resume r ON r.assetId = u.id
    WHERE u.id = ? AND u.owner = ? AND u.status = 'uploading' AND u.expiresAt > ?
    ON CONFLICT(assetId, partNumber) DO NOTHING`).bind(partNumber, etag, id, owner, Date.now()).run();
  const saved = await db.prepare("SELECT etag FROM upload_part_receipts WHERE assetId = ? AND partNumber = ?")
    .bind(id, partNumber).first<{ etag: string }>();
  if (saved?.etag !== etag) throw new UploadError(409, "分片回执冲突或文件指纹尚未建立，请核对上传状态。");
}
