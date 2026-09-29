import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { readUpload, UploadError } from "./uploads.ts";
import { validateProcessingResult } from "./processing-result.ts";
import type { MediaKind } from "./media.ts";
import { verifyDerivative } from "./derivative-verification.ts";

type ProcessingJob = { assetId: string; status: string; attempts: number; leaseToken: string; leaseExpiresAt: number };

export async function failProcessing(db: D1Database, assetId: string, leaseToken: string, error: unknown, now = Date.now()) {
  if (typeof error !== 'string' || !error.trim() || error.length > 300 || /[\x00-\x1f\x7f]/.test(error)) throw new UploadError(400, '处理错误说明无效。');
  // Never store machine paths, credentials or parser output supplied by a tool.
  const saved = await db.prepare(`UPDATE processing_jobs SET status='failed', error=?, leaseToken=NULL, leaseExpiresAt=0
    WHERE assetId=? AND status='running' AND leaseToken=? AND leaseExpiresAt>? RETURNING assetId`)
    .bind('电脑处理失败。请检查文件能否在 CAD / 媒体软件中打开、转换工具配置及处理限制，然后重试。', assetId, leaseToken, now).first();
  if (!saved) throw new UploadError(409, '处理租约已失效，请刷新状态。');
  return { failed: true };
}

export async function retryProcessing(db: D1Database, owner: string, assetId: string, now = Date.now()) {
  const upload = await readUpload(db, owner, assetId);
  if (upload.status !== 'processing_pending') throw new UploadError(409, '原件尚未校验完成。');
  const saved = await db.prepare(`UPDATE processing_jobs SET status='pending', attempts=0, error=NULL,
    leaseToken=NULL, leaseExpiresAt=0, resultManifest=NULL, resultLeaseToken=NULL, verifiedObjects=NULL, verifiedAt=NULL
    WHERE assetId=? AND (status='failed' OR (status='running' AND leaseExpiresAt<=?))
    AND EXISTS(SELECT 1 FROM upload_sessions WHERE id=? AND owner=? AND status='processing_pending') RETURNING assetId`)
    .bind(assetId, now, assetId, owner).first();
  if (!saved) throw new UploadError(409, '任务正在处理、已完成或已排队，请刷新状态。');
  return { queued: true };
}

export async function completeProcessing(db: D1Database, bucket: R2Bucket, assetId: string, leaseToken: string) {
  const completed = await db.prepare(`SELECT assetId, status FROM processing_jobs WHERE assetId = ?
    AND status = 'ready' AND leaseToken = ? AND resultLeaseToken = ? AND verifiedObjects IS NOT NULL`)
    .bind(assetId, leaseToken, leaseToken).first<{ assetId: string; status: string }>();
  if (completed) return completed;
  const row = await db.prepare(`SELECT resultManifest FROM processing_jobs WHERE assetId = ?
    AND status = 'running' AND leaseToken = ? AND resultLeaseToken = ? AND leaseExpiresAt > ?`)
    .bind(assetId, leaseToken, leaseToken, Date.now()).first<{ resultManifest: string }>();
  if (!row?.resultManifest) throw new UploadError(409, "处理清单或租约无效。");
  const result = JSON.parse(row.resultManifest) as ReturnType<typeof validateProcessingResult>;
  const verified = [];
  for (const file of result.files) verified.push(await verifyDerivative(bucket, file));
  const saved = await db.prepare(`UPDATE processing_jobs SET status = 'ready', verifiedObjects = ?, verifiedAt = ?
    WHERE assetId = ? AND status = 'running' AND leaseToken = ? AND resultLeaseToken = ?
    AND leaseExpiresAt > ? AND resultManifest = ? RETURNING assetId, status`)
    .bind(JSON.stringify(verified), Date.now(), assetId, leaseToken, leaseToken, Date.now(), row.resultManifest)
    .first<{ assetId: string; status: string }>();
  if (!saved) throw new UploadError(409, "校验期间任务状态已变化，请重新确认。");
  return saved;
}

export async function registerProcessingResult(db: D1Database, assetId: string, leaseToken: string, input: unknown, now = Date.now()) {
  const upload = await db.prepare(`SELECT u.kind FROM upload_sessions u JOIN processing_jobs j ON j.assetId = u.id
    WHERE u.id = ? AND u.status = 'processing_pending' AND j.status = 'running'
    AND j.leaseToken = ? AND j.leaseExpiresAt > ?`).bind(assetId, leaseToken, now).first<{ kind: MediaKind }>();
  if (!upload) throw new UploadError(409, "处理租约已失效。");
  const result = validateProcessingResult(assetId, upload.kind, input);
  const manifest = JSON.stringify(result);
  const saved = await db.prepare(`UPDATE processing_jobs SET resultManifest = ?, resultLeaseToken = ?
    WHERE assetId = ? AND status = 'running' AND leaseToken = ? AND leaseExpiresAt > ?
    AND (resultManifest IS NULL OR resultLeaseToken != ? OR resultManifest = ?)
    RETURNING assetId`).bind(manifest, leaseToken, assetId, leaseToken, now, leaseToken, manifest).first();
  if (!saved) throw new UploadError(409, "处理清单已锁定或租约已改变，请勿更换本次处理结果。");
  return result;
}

// Machine authentication must precede this lookup; the caller never chooses an R2 key.
export async function processingSource(db: D1Database, bucket: R2Bucket, assetId: string, leaseToken: string, now = Date.now(), range?: {offset:number;length:number}) {
  const upload = await db.prepare(`SELECT u.objectKey, u.storageVersion, u.storageEtag, u.size
    FROM upload_sessions u JOIN processing_jobs j ON j.assetId = u.id
    WHERE u.id = ? AND u.status = 'processing_pending' AND j.status = 'running'
    AND j.leaseToken = ? AND j.leaseExpiresAt > ?`).bind(assetId, leaseToken, now)
    .first<{ objectKey: string; storageVersion: string; storageEtag: string; size: number }>();
  if (!upload || upload.objectKey !== `originals/${assetId}` || !upload.storageEtag || !upload.storageVersion) {
    throw new UploadError(409, "处理租约或原文件记录无效。");
  }
  if(range&&(!Number.isSafeInteger(range.offset)||range.offset<0||range.offset>=upload.size||!Number.isSafeInteger(range.length)||range.length<1||range.length>8*1024**2))throw new UploadError(400,"原件下载分段无效。");
  const object = await bucket.get(upload.objectKey, { onlyIf: { etagMatches: upload.storageEtag }, ...(range?{range:{offset:range.offset,length:Math.min(range.length,upload.size-range.offset)}}:{}) });
  if (!object || !("arrayBuffer" in object)) throw new UploadError(409, "原文件已变化或不存在。");
  if (object.size !== upload.size || object.version !== upload.storageVersion) {
    await object.body.cancel();
    throw new UploadError(409, "原文件版本或大小已变化。");
  }
  return object;
}

export async function renewProcessingLease(db: D1Database, assetId: string, leaseToken: string, now = Date.now()) {
  const job = await db.prepare(`UPDATE processing_jobs SET leaseExpiresAt = ?
    WHERE assetId = ? AND leaseToken = ? AND status = 'running' AND leaseExpiresAt > ?
    RETURNING assetId, status, attempts, leaseToken, leaseExpiresAt`)
    .bind(now + 15 * 60 * 1000, assetId, leaseToken, now).first<ProcessingJob>();
  if (!job) throw new UploadError(409, "处理租约已失效，请停止本次处理并重新领取任务。");
  return job;
}

// Internal service only: a machine-authenticated endpoint must guard any remote caller.
export async function claimProcessingJob(db: D1Database, now = Date.now()) {
  // Reconciliation also repairs a crash between upload completion and queue insertion.
  await db.prepare(`INSERT INTO processing_jobs (assetId, createdAt)
    SELECT id, createdAt FROM upload_sessions
    WHERE status = 'processing_pending' AND storageVersion IS NOT NULL AND storageEtag IS NOT NULL
    ON CONFLICT(assetId) DO NOTHING`).run();
  await db.prepare(`UPDATE processing_jobs SET status = 'failed', error = '处理重试次数已用尽。', leaseToken = NULL
    WHERE status = 'running' AND leaseExpiresAt <= ? AND attempts >= 3`).bind(now).run();
  return db.prepare(`UPDATE processing_jobs SET status = 'running', attempts = attempts + 1,
    leaseToken = ?, leaseExpiresAt = ?, error = NULL
    WHERE assetId = (SELECT assetId FROM processing_jobs WHERE attempts < 3
      AND (status = 'pending' OR (status = 'running' AND leaseExpiresAt <= ?))
      ORDER BY createdAt, assetId LIMIT 1)
    RETURNING assetId, status, attempts, leaseToken, leaseExpiresAt`)
    .bind(crypto.randomUUID(), now + 15 * 60 * 1000, now).first<ProcessingJob>();
}
