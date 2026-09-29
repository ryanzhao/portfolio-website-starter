import type { R2Bucket } from "@cloudflare/workers-types";
import { UploadError } from "./uploads.ts";
import { mediaRange } from "./media-range.ts";

// PUBLISHED binding only. Never retry this lookup against ORIGINALS.
export async function readPublicMedia(published: R2Bucket, key: string, rangeHeader?: string | null) {
  const match = /^derivatives\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/([a-f0-9]{64})\/(thumbnail|detail|poster|video|model)\.(webp|mp4|glb)$/.exec(key);
  if (!match || (match[2] === "video" ? "mp4" : match[2] === "model" ? "glb" : "webp") !== match[3]) throw new UploadError(404, "素材不存在。");
  const head = await published.head(key);
  if (!head) throw new UploadError(404, "素材不存在。");
  const mimeType = match[3] === "glb" ? "model/gltf-binary" : match[3] === "mp4" ? "video/mp4" : "image/webp";
  if (!head.checksums.sha256 || Buffer.from(head.checksums.sha256).toString("hex") !== match[1] ||
    head.httpMetadata?.contentType !== mimeType || head.size < 1 || head.size > (match[3] === "glb" ? 50 * 1024 ** 2 : 2 * 1024 ** 3)) throw new UploadError(409, "素材校验信息不匹配。");
  const range = mediaRange(rangeHeader, head.size);
  const object = await published.get(key, { onlyIf: { etagMatches: head.etag }, ...(range ? { range } : {}) });
  if (!object || !("arrayBuffer" in object)) throw new UploadError(409, "素材版本已变化。");
  if (object.version !== head.version || object.size !== head.size) {
    await object.body.cancel(); throw new UploadError(409, "素材版本已变化。");
  }
  return { object, range, mimeType };
}
