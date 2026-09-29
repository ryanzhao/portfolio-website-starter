import type { D1Database } from "@cloudflare/workers-types";
import { AwsV4Signer } from "aws4fetch";
import { UploadError } from "./uploads.ts";
import { validateProcessingResult } from "./processing-result.ts";

// Machine authentication precedes this call. File paths and sizes come from D1.
export async function signResultUpload(db: D1Database, assetId: string, leaseToken: string, role: unknown,
  env: Record<string, string | undefined>, now = Date.now()) {
  const row = await db.prepare(`SELECT resultManifest, leaseExpiresAt FROM processing_jobs
    WHERE assetId = ? AND status = 'running' AND leaseToken = ? AND resultLeaseToken = ? AND leaseExpiresAt > ?`)
    .bind(assetId, leaseToken, leaseToken, now).first<{ resultManifest: string; leaseExpiresAt: number }>();
  if (!row?.resultManifest) throw new UploadError(409, "处理清单或租约无效。");
  const result = JSON.parse(row.resultManifest) as ReturnType<typeof validateProcessingResult>;
  const file = result.files.find(file => file.role === role);
  if (!file || !/^derivatives\/[a-f0-9-]{36}\/[a-f0-9]{64}\/(?:(?:thumbnail|detail|poster)\.webp|video\.mp4|model\.glb)$/.test(file.key) ||
    file.key !== `derivatives/${assetId}/${file.sha256}/${file.role}.${file.mimeType === "model/gltf-binary" ? "glb" : file.mimeType === "video/mp4" ? "mp4" : "webp"}`) {
    throw new UploadError(400, "衍生文件标识无效。");
  }
  const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!account || !/^[a-f0-9]{32}$/.test(account) || !accessKeyId || !secretAccessKey) throw new UploadError(503, "文件直传授权尚未配置。");
  const seconds = Math.min(300, Math.floor((row.leaseExpiresAt - now) / 1000));
  if (seconds < 1) throw new UploadError(409, "处理租约即将过期。");
  const url = new URL(`https://${account}.r2.cloudflarestorage.com/openmpd/${file.key}`);
  url.searchParams.set("X-Amz-Expires", String(seconds));
  const headers = { "content-length": String(file.size), "content-type": file.mimeType, "if-none-match": "*" };
  const signed = await new AwsV4Signer({ url: url.href, method: "PUT", accessKeyId, secretAccessKey,
    service: "s3", region: "auto", signQuery: true, allHeaders: true, headers }).sign();
  // Signing does not verify bytes or mark ready. A separate stored-file check is mandatory.
  return { url: signed.url.href, method: "PUT" as const, headers, expiresAt: now + seconds * 1000 };
}
