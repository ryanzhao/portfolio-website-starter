import type { Mutation } from "@sanity/client";
import type { readPlacementCandidate } from "./placement-candidate.ts";
import { publishedPlacementId, validatePlacement, MediaValidationError } from "./media.ts";
import { publicMediaVariants } from "./processing-result.ts";

// Submit this entire array in ONE Sanity mutate call after snapshot and copies.
// https://www.sanity.io/docs/content-lake/transactions
export function publicationMutations(candidate: Awaited<ReturnType<typeof readPlacementCandidate>>, copied: unknown, previousRevision: unknown): Mutation[] {
  const validRevision = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 256 && !/\s/.test(value);
  if (!validRevision(candidate.revision) || (previousRevision !== null && !validRevision(previousRevision)) ||
    !["image", "video"].includes(candidate.kind) || !Array.isArray(copied)) throw new MediaValidationError("发布版本或素材清单无效。");
  const placement = validatePlacement(candidate.placement, candidate.kind);
  const files = publicMediaVariants(placement.assetId, candidate.kind, copied);
  const id = publishedPlacementId(placement.slotId);
  const document = { _id: id, _type: "mediaPlacement", ...placement, kind: candidate.kind, variants: files };
  const mutations: Mutation[] = [{ patch: { id: `drafts.placement-${placement.slotId}`, ifRevisionID: candidate.revision!, set: placement } }];
  if (previousRevision === null) mutations.push({ create: document });
  else mutations.push({ patch: { id, ifRevisionID: previousRevision as string, set: { slotId: placement.slotId } } }, { createOrReplace: document });
  return mutations;
}
