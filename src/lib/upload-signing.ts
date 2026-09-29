import { AwsV4Signer } from "aws4fetch";
import { readUpload, uploadPartRange, UploadError } from "./uploads.ts";

// Caller must read this session with the authenticated owner before signing.
export async function signUploadPart(upload: Awaited<ReturnType<typeof readUpload>>, partNumber: unknown,
  env: Record<string, string | undefined>) {
  const range = uploadPartRange(upload, partNumber);
  if (!/^originals\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(upload.objectKey) ||
    upload.objectKey !== `originals/${upload.id}`) throw new UploadError(400, "原文件标识无效。");
  const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!account || !/^[a-f0-9]{32}$/.test(account) || !accessKeyId || !secretAccessKey) {
    throw new UploadError(503, "文件直传授权尚未配置。");
  }
  const seconds = Math.min(300, Math.floor((upload.expiresAt - Date.now()) / 1000));
  if (seconds < 1) throw new UploadError(409, "上传会话即将过期。");
  const url = new URL(`https://${account}.r2.cloudflarestorage.com/openmpd/${upload.objectKey}`);
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", upload.uploadId!);
  url.searchParams.set("X-Amz-Expires", String(seconds));
  const signed = await new AwsV4Signer({ url: url.href, method: "PUT", accessKeyId, secretAccessKey,
    service: "s3", region: "auto", signQuery: true, allHeaders: true,
    headers: { "content-length": String(range.length) },
  }).sign();
  // Browser sets Content-Length from the Blob; never attempt to set this forbidden header in JS.
  // Real browser/R2 acceptance of the signed header remains a deployment acceptance check.
  return { url: signed.url.href, method: "PUT" as const, ...range, expiresAt: Date.now() + seconds * 1000 };
}
