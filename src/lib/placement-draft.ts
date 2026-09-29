import { mediaSlots, MediaValidationError, validatePlacement, type MediaKind } from "./media.ts";
import type { D1Database } from "@cloudflare/workers-types";
import type { SanityClient } from "@sanity/client";
import { readUpload, UploadError } from "./uploads.ts";

// Caller must authenticate before reading private drafts. Return editor fields only.
export async function readPlacementDraft(client: Pick<SanityClient, "getDocument">, slotId: unknown) {
  if (typeof slotId !== "string" || !mediaSlots.some(slot => slot.id === slotId)) {
    throw new MediaValidationError("展示位置不存在。");
  }
  const document = await client.getDocument(`drafts.placement-${slotId}`);
  if (!document) return { revision: null, placement: null };
  if (document.slotId !== slotId || typeof document._rev !== "string" ||
    !document._rev.length || document._rev.length > 256 || /\s/.test(document._rev)) {
    throw new UploadError(409, "草稿记录或版本异常，请先检查内容记录。");
  }
  const placement = validatePlacement({
    slotId, assetId: document.assetId, alt: document.alt, caption: document.caption,
  }, "image"); // Every current slot accepts images; actual asset kind is checked on save.
  return { revision: document._rev, placement };
}

// owner must be the verified Access subject. Draft placement is permitted while
// media processing is pending; publication must independently require ready derivatives.
export async function savePlacementDraft(db: D1Database, client: Pick<SanityClient, "mutate">,
  owner: string, input: unknown, revision: unknown) {
  if (!input || typeof input !== "object" || !("assetId" in input) || typeof input.assetId !== "string") {
    throw new MediaValidationError("素材标识无效。");
  }
  const upload = await readUpload(db, owner, input.assetId);
  if (upload.status !== "processing_pending" || !upload.storageVersion || !upload.storageEtag) {
    throw new UploadError(409, "原文件尚未完成上传校验，暂不能保存展示位置。");
  }
  const mutation = placementDraftMutation(input, upload.kind, revision);
  return client.mutate([mutation], { visibility: "sync", returnDocuments: false });
}

// Caller verifies asset ownership/readiness and administrator identity separately.
// null means create-only: a concurrent existing draft must cause a conflict, not overwrite.
export function placementDraftMutation(input: unknown, kind: MediaKind, revision: unknown) {
  const placement = validatePlacement(input, kind);
  const id = `drafts.placement-${placement.slotId}`;
  if (revision === null) return { create: { _id: id, _type: "mediaPlacement", ...placement } };
  if (typeof revision !== "string" || !revision.length || revision.length > 256 || /\s/.test(revision)) {
    throw new MediaValidationError("请刷新草稿后再保存，缺少有效版本标识。");
  }
  return { patch: { id, ifRevisionID: revision, set: placement } };
}
