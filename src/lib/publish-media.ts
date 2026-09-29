import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { readPrivateVariant } from "./private-preview.ts";
import { verifyDerivative } from "./derivative-verification.ts";
import { UploadError } from "./uploads.ts";

// Called only inside an authorized publication workflow, after its private snapshot.
// R2 conditional put + checksum: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
export async function copyPublishedVariant(db: D1Database, originals: R2Bucket, published: R2Bucket,
  owner: string, assetId: string, role: string) {
  if (originals === published) throw new UploadError(503, "公开与私有存储必须隔离。");
  const { object, mimeType, width, height, duration } = await readPrivateVariant(db, originals, owner, assetId, role);
  const file = { key: object.key, size: object.size, sha256: object.key.split("/")[2], mimeType };
  try {
    await published.put(file.key, object.body, { onlyIf: { etagDoesNotMatch: "*" }, sha256: file.sha256,
      httpMetadata: { contentType: mimeType, cacheControl: "public, max-age=31536000, immutable" } });
  } finally { if (!object.bodyUsed) await object.body.cancel().catch(() => {}); }
  const verified = await verifyDerivative(published, file);
  return { ...file, width, height, role, ...(duration !== undefined ? { duration } : {}), version: verified.version };
}
