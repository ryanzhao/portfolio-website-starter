import type { D1Database } from "@cloudflare/workers-types";
import { readUpload, UploadError } from "./uploads.ts";

export type LibraryItem = {
  id: string; filename: string; mimeType: string; size: number; kind: "image" | "video" | "model";
  status: "uploading" | "completing" | "processing_pending" | "rejected" | "cancelling" | "cancelled";
  createdAt: number; expiresAt: number;
  processingStatus: "pending" | "running" | "failed" | "ready" | null;
  processingError?: string | null; leaseExpiresAt?: number | null;
  tags: string[]; tagRevision: number;
};

export async function listAssets(db: D1Database, owner: string,
  options: { q?: string; kind?: string; tag?: string; offset?: number } = {}) {
  const { q = "", kind = "", tag = "", offset = 0 } = options;
  if (!owner || owner.length > 256 || Object.keys(options).some(key => !["q", "kind", "tag", "offset"].includes(key)) ||
    typeof q !== "string" || q.length > 255 || typeof tag !== "string" || [...tag].length > 30 ||
    !["", "image", "video", "model"].includes(kind) || !Number.isSafeInteger(offset) || offset < 0 || offset > 9999999) {
    throw new UploadError(400, "素材查询无效。");
  }
  if (!db) throw new UploadError(503, "素材记录服务尚未配置。");
  const where = ["u.owner = ?"];
  const values: (string | number)[] = [owner];
  if (q) { where.push("u.filename LIKE ? ESCAPE '\\'"); values.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`); }
  if (kind) { where.push("u.kind = ?"); values.push(kind); }
  if (tag) { where.push("EXISTS (SELECT 1 FROM json_each(t.tags) WHERE value = ?)"); values.push(tag); }
  // ponytail: offset pages can shift under new uploads; refresh returns newest first.
  const rows = await db.prepare(`SELECT u.id, u.filename, u.mimeType, u.size, u.kind, u.status, u.createdAt, u.expiresAt,
    j.status AS processingStatus, j.error AS processingError, j.leaseExpiresAt,
    COALESCE(t.tags, '[]') AS tags, COALESCE(t.revision, 0) AS tagRevision
    FROM upload_sessions u LEFT JOIN processing_jobs j ON j.assetId = u.id LEFT JOIN asset_tags t ON t.assetId = u.id
    WHERE ${where.join(" AND ")} ORDER BY u.createdAt DESC, u.id DESC LIMIT 51 OFFSET ?`)
    .bind(...values, offset).all<Omit<LibraryItem, "tags"> & { tags: string }>();
  const labels = await db.prepare(`SELECT DISTINCT label.value AS tag FROM asset_tags t
    JOIN upload_sessions u ON u.id = t.assetId, json_each(t.tags) label
    WHERE u.owner = ? ORDER BY label.value`).bind(owner).all<{ tag: string }>();
  const items: LibraryItem[] = rows.results.slice(0, 50).map(row => ({ ...row, tags: JSON.parse(row.tags) as string[] }));
  return { items, nextOffset: rows.results.length > 50 ? offset + 50 : null, tags: labels.results.map(row => row.tag) };
}

export async function saveAssetTags(db: D1Database, owner: string, id: string, input: unknown, revision: unknown) {
  if (!Array.isArray(input) || input.some(tag => typeof tag !== "string") ||
    typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new UploadError(400, "标签或版本格式无效。");
  }
  const tags = [...new Set((input as string[]).map(tag => tag.trim()).filter(Boolean))];
  if (tags.length > 12 || tags.some(tag => [...tag].length > 30 || /[\x00-\x1f\x7f]/.test(tag))) {
    throw new UploadError(400, "每个素材最多 12 个标签，每个标签最多 30 字。");
  }
  if (!db) throw new UploadError(503, "素材记录服务尚未配置。");
  await readUpload(db, owner, id);
  // Guard both first insert and later updates inside the same atomic statement.
  const saved = await db.prepare(`INSERT INTO asset_tags(assetId, tags, revision)
    SELECT id, ?, 1 FROM upload_sessions WHERE id = ? AND owner = ?
    AND (? = 0 OR EXISTS (SELECT 1 FROM asset_tags WHERE assetId = ? AND revision = ?))
    ON CONFLICT(assetId) DO UPDATE SET tags = excluded.tags, revision = asset_tags.revision + 1
    WHERE asset_tags.revision = ? RETURNING revision`)
    .bind(JSON.stringify(tags), id, owner, revision, id, revision, revision).first<{ revision: number }>();
  if (!saved) throw new UploadError(409, "标签版本已变化，请刷新后重新确认；未自动覆盖。");
  return { tags, revision: saved.revision };
}
