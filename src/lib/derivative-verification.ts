import type { R2Bucket } from "@cloudflare/workers-types";
import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { MAX_MODEL_BYTES, validateModelGlb } from "./model-glb.ts";
import { UploadError } from "./uploads.ts";

// Only supply a file from the server's registered manifest after checking its lease.
export async function verifyDerivative(bucket: R2Bucket, file: { key: string; size: number; sha256: string; mimeType: string }) {
  if (!/^derivatives\/[a-f0-9-]{36}\/[a-f0-9]{64}\/(?:(?:thumbnail|detail|poster)\.webp|video\.mp4|model\.glb)$/.test(file.key) ||
    !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 2 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
    throw new UploadError(400, "衍生文件清单无效。");
  }
  const isModel = file.key.endsWith("/model.glb");
  if (file.mimeType !== (isModel ? "model/gltf-binary" : file.key.endsWith("/video.mp4") ? "video/mp4" : "image/webp") || (isModel && file.size > MAX_MODEL_BYTES)) throw new UploadError(400, "Invalid derivative format.");
  const object = await bucket.get(file.key);
  if (!object) throw new UploadError(409, "衍生文件尚未上传。");
  if (object.size !== file.size) { await object.body.cancel(); throw new UploadError(409, "衍生文件大小不匹配。"); }
  const hash = createHash("sha256");
  // One bounded allocation: validate binary geometry without copying the full GLB.
  const prefix = new Uint8Array(isModel ? file.size : Math.min(65536, file.size));
  let size = 0, prefixSize = 0;
  const reader = object.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > file.size) throw new UploadError(409, "衍生文件读取大小异常。");
      hash.update(value);
      const length = Math.min(value.byteLength, prefix.length - prefixSize);
      if (length) { prefix.set(value.subarray(0, length), prefixSize); prefixSize += length; }
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  if (isModel) {
    try { validateModelGlb(prefix.subarray(0, prefixSize)); }
    catch { throw new UploadError(409, "Invalid GLB content."); }
  }
  const detected = isModel ? { mime: "model/gltf-binary" } : await fileTypeFromBuffer(prefix.subarray(0, prefixSize)).catch(() => undefined);
  if (size !== file.size || hash.digest("hex") !== file.sha256 || detected?.mime !== file.mimeType) {
    throw new UploadError(409, "衍生文件校验值或实际格式不匹配。");
  }
  const current = await bucket.head(file.key);
  if (current?.version !== object.version) throw new UploadError(409, "校验期间衍生文件发生变化。");
  return { key: file.key, version: object.version, etag: object.etag };
}
