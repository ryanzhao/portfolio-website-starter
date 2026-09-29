import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { SanityClient } from "@sanity/client";
import { readPlacementSnapshot, writePlacementSnapshot } from "./placement-snapshot.ts";
import { readPlacementDraft, savePlacementDraft } from "./placement-draft.ts";
import { readPrivateVariant } from "./private-preview.ts";
import { readUpload, UploadError } from "./uploads.ts";
import { mediaSlots } from "./media.ts";

type RecoveryStorage = { UPLOADS: D1Database; ORIGINALS: R2Bucket; BACKUPS: R2Bucket };

export async function readPlacementHistory(storage: RecoveryStorage, client: Pick<SanityClient, "getDocument">,
  owner: string, slotId: unknown, cursor?: string, snapshotId?: string) {
  if (cursor && (cursor.length > 2048 || /[\x00-\x20\x7f]/.test(cursor))) throw new UploadError(400, "历史页码无效。");
  const current = await readPlacementDraft(client, slotId);
  if (current.placement) await readUpload(storage.UPLOADS, owner, current.placement.assetId);
  // ponytail: scan 20 immutable snapshots per page; add a slot index if archive size makes paging impractical.
  const page = snapshotId ? null : await storage.BACKUPS.list({ prefix: "snapshots/placements/", limit: 20, cursor });
  const ids = snapshotId ? [snapshotId] : page!.objects.map(object => object.key.slice("snapshots/placements/".length, -5));
  const items = [];
  for (const id of ids) {
    try {
      const snapshot = await readPlacementSnapshot(storage.BACKUPS, id);
      if (snapshot.candidate.placement.slotId !== slotId) continue;
      const owned = async (entry: typeof snapshot.candidate | null) => {
        if (!entry) return null;
        try { await readUpload(storage.UPLOADS, owner, entry.placement.assetId); return entry; }
        catch (error) { if (error instanceof UploadError && error.status === 404) return null; throw error; }
      };
      const candidate = await owned(snapshot.candidate), previous = await owned(snapshot.previous);
      if (candidate || previous) items.push({ id, version: snapshot.version, candidate, previous });
    } catch (error) {
      if (snapshotId || !(error instanceof UploadError) || ![400,404,409].includes(error.status)) throw error;
      // Corrupt records cannot be offered as restoration candidates.
    }
  }
  if (snapshotId && !items.length) throw new UploadError(404, "找不到可访问的历史版本。");
  return { current, items, nextCursor: page?.truncated ? page.cursor : null };
}

export function validateRecoveryInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new UploadError(400, "恢复请求无效。");
  const body = input as Record<string, unknown>;
  const revision = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 256 && !/\s/.test(value);
  if (Object.keys(body).some(key => !["snapshotId", "version", "side", "slotId", "revision", "confirmed"].includes(key)) ||
    body.confirmed !== true || (body.side !== "candidate" && body.side !== "previous") ||
    typeof body.snapshotId !== "string" || !/^[a-f0-9]{64}$/.test(body.snapshotId) || !revision(body.version) ||
    !mediaSlots.some(slot => slot.id === body.slotId) || (body.revision !== null && !revision(body.revision))) {
    throw new UploadError(400, "请明确确认有效历史版本并恢复为私有草稿。");
  }
  return { snapshotId: body.snapshotId, version: body.version, slotId: body.slotId, revision: body.revision,
    side: body.side as "candidate" | "previous", confirmed: true };
}

async function record(backups: R2Bucket, key: string, value: object) {
  const text = JSON.stringify(value);
  await backups.put(key, text, { onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
  const saved = await backups.get(key);
  if (!saved || await saved.text() !== text || (await backups.head(key))?.version !== saved.version) {
    throw new UploadError(503, "恢复操作记录未确认，请核对草稿，勿盲目重复操作。");
  }
}

// Caller independently authenticates administrator and exact write Origin.
export async function restorePlacementDraft(storage: RecoveryStorage,
  client: Pick<SanityClient, "getDocument" | "mutate">, owner: string, input: unknown) {
  const body = validateRecoveryInput(input);
  const { UPLOADS, ORIGINALS, BACKUPS } = storage;
  if (!UPLOADS || !ORIGINALS || !BACKUPS || ORIGINALS === BACKUPS) throw new UploadError(503, "恢复存储未配置或未隔离。");
  const snapshot = await readPlacementSnapshot(BACKUPS, body.snapshotId);
  if (body.version !== snapshot.version) throw new UploadError(409, "快照版本已变化，请重新读取。");
  const target = snapshot[body.side];
  if (!target || target.placement.slotId !== body.slotId) throw new UploadError(400, "历史版本或展示位置不匹配。");
  const upload = await readUpload(UPLOADS, owner, target.placement.assetId);
  if (upload.kind !== target.kind || upload.status !== "processing_pending") throw new UploadError(409, "历史素材状态不匹配。");
  for (const role of target.kind === "image" ? ["thumbnail", "detail"] : ["poster", "video"]) {
    const { object } = await readPrivateVariant(UPLOADS, ORIGINALS, owner, upload.id, role);
    await object.body.cancel();
  }
  const current = await readPlacementDraft(client, body.slotId);
  if (current.revision !== body.revision) throw new UploadError(409, "当前草稿已变化，请重新比较后确认。");
  let preservedSnapshot: string | null = null;
  if (current.placement) {
    const asset = await readUpload(UPLOADS, owner, current.placement.assetId);
    preservedSnapshot = (await writePlacementSnapshot(BACKUPS, {
      revision: current.revision, kind: asset.kind, placement: current.placement,
    }, null)).sha256;
  }
  const operationId = crypto.randomUUID();
  const operation = { operationId, owner, snapshotId: body.snapshotId, version: snapshot.version, side: body.side,
    slotId: body.slotId, previousRevision: current.revision, preservedSnapshot, createdAt: new Date().toISOString() };
  const prefix = `operations/restores/${operationId}`;
  await record(BACKUPS, `${prefix}/attempt.json`, { ...operation, status: "started" });
  let result;
  try {
    result = await savePlacementDraft(UPLOADS, client, owner, target.placement, current.revision);
  } catch (error) {
    // A network failure may occur after commit. Never claim it definitely failed or auto-retry.
    const conflict = error instanceof Error && "statusCode" in error && error.statusCode === 409;
    await record(BACKUPS, `${prefix}/result.json`, { ...operation, status: conflict ? "conflict" : "unknown" });
    throw new UploadError(conflict ? 409 : 503, `恢复结果需核对（操作 ${operationId}）。请重新读取草稿，勿盲目重试。`);
  }
  await record(BACKUPS, `${prefix}/result.json`, { ...operation, status: "succeeded", transactionId: result.transactionId });
  return { saved: true, published: false, operationId, preservedSnapshot };
}
