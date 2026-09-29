import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { validateProcessingResult } from "./processing-result.ts";
import { UploadError } from "./uploads.ts";
import { mediaRange } from "./media-range.ts";

// owner must be the verified administrator subject. Never expose this via public caching.
export async function readPrivateVariant(db: D1Database, bucket: R2Bucket, owner: string, assetId: string, role: string, rangeHeader?: string | null) {
  const row = await db.prepare(`SELECT j.resultManifest, j.verifiedObjects FROM processing_jobs j
    JOIN upload_sessions u ON u.id = j.assetId WHERE u.owner = ? AND u.id = ? AND j.status = 'ready'`)
    .bind(owner, assetId).first<{ resultManifest: string; verifiedObjects: string }>();
  if (!row?.resultManifest || !row.verifiedObjects) throw new UploadError(404, "素材不存在或尚未处理完成。");
  const result = JSON.parse(row.resultManifest) as ReturnType<typeof validateProcessingResult>;
  const file = result.files.find(file => file.role === role);
  const verified = JSON.parse(row.verifiedObjects) as { key: string; version: string; etag: string }[];
  const stored = file && verified.find(object => object.key === file.key);
  if (!file || !stored || file.key !== `derivatives/${assetId}/${file.sha256}/${role}.${role === "model" ? "glb" : role === "video" ? "mp4" : "webp"}` || !["thumbnail", "detail", "poster", "video", "model"].includes(role) || file.mimeType !== (role === "model" ? "model/gltf-binary" : role === "video" ? "video/mp4" : "image/webp")) throw new UploadError(404, "预览文件不存在。");
  const range = mediaRange(rangeHeader, file.size);
  const object = await bucket.get(file.key, { onlyIf: { etagMatches: stored.etag }, ...(range ? { range } : {}) });
  if (!object || !("arrayBuffer" in object)) throw new UploadError(409, "预览文件已变化或不可用。");
  if (object.version !== stored.version || object.size !== file.size) {
    await object.body.cancel();
    throw new UploadError(409, "预览文件版本不匹配。");
  }
  return { object, range, mimeType: file.mimeType, width: file.width, height: file.height,
    ...(file.duration !== undefined ? { duration: file.duration } : {}) };
}
