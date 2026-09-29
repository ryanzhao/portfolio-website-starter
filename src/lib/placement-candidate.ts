import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { SanityClient } from "@sanity/client";
import { readPlacementDraft } from "./placement-draft.ts";
import { validatePlacement } from "./media.ts";
import { readPrivateVariant } from "./private-preview.ts";
import { readUpload, UploadError } from "./uploads.ts";

// Authenticated read-only preparation. This is not a publication transaction.
export async function readPlacementCandidate(db: D1Database, bucket: R2Bucket,
  client: Pick<SanityClient, "getDocument">, owner: string, slotId: unknown, revision: unknown) {
  const draft = await readPlacementDraft(client, slotId);
  if (!draft.placement || typeof revision !== "string" || draft.revision !== revision) {
    throw new UploadError(409, "草稿版本已变化或不存在，请重新预览并确认。");
  }
  const upload = await readUpload(db, owner, draft.placement.assetId);
  if (upload.status !== "processing_pending") throw new UploadError(409, "素材尚未就绪。");
  const placement = validatePlacement(draft.placement, upload.kind);
  for (const role of upload.kind === "image" ? ["thumbnail", "detail"] : ["poster", "video"]) {
    const { object } = await readPrivateVariant(db, bucket, owner, upload.id, role);
    await object.body.cancel();
  }
  return { revision: draft.revision, placement, kind: upload.kind };
}
