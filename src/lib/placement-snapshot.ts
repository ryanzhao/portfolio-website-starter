import type { R2Bucket } from "@cloudflare/workers-types";
import { createHash } from "node:crypto";
import { validatePlacement } from "./media.ts";
import { UploadError } from "./uploads.ts";

function snapshotEntry(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some(key => !["revision", "placement", "kind"].includes(key))) throw new UploadError(400, "快照字段无效。");
  const entry = value as Record<string, unknown>;
  if ((entry.kind !== "image" && entry.kind !== "video") || typeof entry.revision !== "string" ||
    !entry.revision.length || entry.revision.length > 256 || /\s/.test(entry.revision)) throw new UploadError(400, "快照版本无效。");
  return { revision: entry.revision, kind: entry.kind, placement: validatePlacement(entry.placement, entry.kind) };
}

// Auth/ownership checks belong to the caller. Never accept a bucket key from the browser.
export async function readPlacementSnapshot(backups: R2Bucket, id: unknown) {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) throw new UploadError(400, "快照标识无效。");
  const key = `snapshots/placements/${id}.json`;
  const object = await backups.get(key);
  if (!object) throw new UploadError(404, "快照不存在。");
  if (object.size > 32768) { await object.body.cancel(); throw new UploadError(409, "快照大小异常。"); }
  const text = await object.text();
  if (createHash("sha256").update(text).digest("hex") !== id || (await backups.head(key))?.version !== object.version) {
    throw new UploadError(409, "快照已变化或校验失败。");
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new UploadError(409, "快照格式损坏。"); }
  if (!data || typeof data !== "object" || Array.isArray(data) || data.formatVersion !== 1 ||
    Object.keys(data).some(key => !["formatVersion", "candidate", "previous"].includes(key))) throw new UploadError(409, "快照格式不支持。");
  const candidate = snapshotEntry(data.candidate);
  const previous = data.previous === null ? null : snapshotEntry(data.previous);
  if (previous && previous.placement.slotId !== candidate.placement.slotId) throw new UploadError(409, "快照展示位置不匹配。");
  return { candidate, previous, version: object.version };
}

// BACKUPS binding only. A placement history record, not a full-site backup.
export async function writePlacementSnapshot(backups: R2Bucket, candidateInput: unknown, previousInput: unknown) {
  const candidate = snapshotEntry(candidateInput);
  const previous = previousInput === null ? null : snapshotEntry(previousInput);
  if (previous && previous.placement.slotId !== candidate.placement.slotId) throw new UploadError(400, "快照展示位置不匹配。");
  const text = JSON.stringify({ formatVersion: 1, candidate, previous });
  const sha256 = createHash("sha256").update(text).digest("hex");
  const key = `snapshots/placements/${sha256}.json`;
  await backups.put(key, text, { onlyIf: { etagDoesNotMatch: "*" }, sha256,
    httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
  const stored = await backups.get(key);
  if (!stored) throw new UploadError(503, "快照未保存，不能发布。");
  if (stored.size !== new TextEncoder().encode(text).byteLength) {
    await stored.body.cancel(); throw new UploadError(409, "快照内容冲突，未覆盖历史。");
  }
  if (await stored.text() !== text || (await backups.head(key))?.version !== stored.version) {
    throw new UploadError(409, "快照校验失败，不能发布。");
  }
  return { key, sha256, version: stored.version };
}
