import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { SanityClient } from "@sanity/client";
import { readPlacementCandidate } from "./placement-candidate.ts";
import { writePlacementSnapshot } from "./placement-snapshot.ts";
import { copyPublishedVariant } from "./publish-media.ts";
import { publicationMutations } from "./publication-mutation.ts";
import { UploadError } from "./uploads.ts";
import { publishedPlacementId } from "./media.ts";

// Caller must verify administrator, same-origin request and publication approval.
export async function publishPlacement(storage: { UPLOADS: D1Database; ORIGINALS: R2Bucket; PUBLISHED: R2Bucket; BACKUPS: R2Bucket },
  client: Pick<SanityClient, "getDocument" | "mutate">, owner: string, slotId: unknown, revision: unknown, previousRevision: unknown) {
  const { UPLOADS, ORIGINALS, PUBLISHED, BACKUPS } = storage;
  if (!UPLOADS || !ORIGINALS || !PUBLISHED || !BACKUPS || ORIGINALS === PUBLISHED || ORIGINALS === BACKUPS || PUBLISHED === BACKUPS) {
    throw new UploadError(503, "发布存储未配置或未隔离。");
  }
  const candidate = await readPlacementCandidate(UPLOADS, ORIGINALS, client, owner, slotId, revision);
  const previousDocument = await client.getDocument(publishedPlacementId(candidate.placement.slotId));
  if ((previousDocument?._rev ?? null) !== previousRevision) throw new UploadError(409, "公开版本已变化，请重新预览后确认。");
  const previous = previousDocument ? { revision: previousDocument._rev, kind: previousDocument.kind, placement: {
    slotId: previousDocument.slotId, assetId: previousDocument.assetId, alt: previousDocument.alt, caption: previousDocument.caption,
  } } : null;
  const snapshot = await writePlacementSnapshot(BACKUPS, candidate, previous);
  const files = [];
  for (const role of candidate.kind === "image" ? ["thumbnail", "detail"] : ["poster", "video"]) {
    files.push(await copyPublishedVariant(UPLOADS, ORIGINALS, PUBLISHED, owner, candidate.placement.assetId, role));
  }
  const result = await client.mutate(publicationMutations(candidate, files, previousRevision), { visibility: "sync", returnDocuments: false });
  return { transactionId: result.transactionId, snapshot };
}
