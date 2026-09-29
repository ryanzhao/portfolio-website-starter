import { fileTypeFromBuffer } from "file-type";
import type { R2Bucket } from "@cloudflare/workers-types";
import { MediaValidationError, validateUpload } from "./media.ts";

// Server-only completion check: length and prefix must come from private storage,
// never from the client's completion request. Read at most 64 KiB with an R2 range.
// Signatures are only a preflight, not decoding, malware scanning or readiness.
export async function inspectStoredUpload(value: unknown, storedSize: number, prefix: Uint8Array) {
  const upload = validateUpload(value);
  if (storedSize !== upload.size || !prefix.length || prefix.length > Math.min(storedSize, 65536)) {
    throw new MediaValidationError("存储文件大小不匹配，或文件头无效。");
  }
  if (upload.kind === "model") {
    if (upload.mimeType === "model/gltf-binary") {
      const header = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
      if (prefix.length < 20 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== storedSize) {
        throw new MediaValidationError("GLB 文件头无效，请重新导出 GLB 2.0。");
      }
      return { ...upload, processingStatus: "processing_pending" as const };
    }
    // STEP Part 21 preflight only; the local CAD parser must still decode geometry.
    const text = new TextDecoder().decode(prefix);
    if (!/^\s*ISO-10303-21\s*;/i.test(text) || !/\bHEADER\s*;/i.test(text) || !/\bFILE_SCHEMA\s*\(/i.test(text) || /\x00/.test(text)) {
      throw new MediaValidationError("文件不是可识别的 STEP 模型，请从 CAD 软件重新导出 STEP/STP。");
    }
    return { ...upload, processingStatus: "processing_pending" as const };
  }
  const detected = await fileTypeFromBuffer(prefix).catch(() => undefined);
  if (detected?.mime !== upload.mimeType) {
    throw new MediaValidationError("实际文件格式与声明不符，或无法识别文件格式。");
  }
  return { ...upload, processingStatus: "processing_pending" as const };
}

// Call only after session ownership/expiry checks, with the private originals
// binding and a key retrieved from server state, not a client-selected key.
export async function inspectPrivateObject(bucket: R2Bucket, key: string, value: unknown) {
  const upload = validateUpload(value);
  if (!/^originals\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) {
    throw new MediaValidationError("私有素材标识无效。");
  }
  const object = await bucket.head(key);
  if (!object || object.size !== upload.size) {
    throw new MediaValidationError("私有文件不存在或大小不匹配。");
  }
  const content = await bucket.get(key, {
    range: { offset: 0, length: Math.min(object.size, 65536) },
    onlyIf: { etagMatches: object.etag },
  });
  if (!content || !("arrayBuffer" in content)) {
    throw new MediaValidationError("读取期间文件发生变化，请重新检查。");
  }
  if (content.version !== object.version) {
    await content.body.cancel();
    throw new MediaValidationError("读取期间文件发生变化，请重新检查。");
  }
  const inspected = await inspectStoredUpload(value, content.size, new Uint8Array(await content.arrayBuffer()));
  return { ...inspected, storageVersion: content.version, storageEtag: content.etag };
}
