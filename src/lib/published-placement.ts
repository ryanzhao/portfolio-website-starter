import type { SanityClient } from "@sanity/client";
import { mediaSlots, publishedPlacementId, validatePlacement, MediaValidationError } from "./media.ts";
import { publicMediaVariants } from "./processing-result.ts";

export async function readPublishedPlacement(client: Pick<SanityClient, "getDocument">, slotId: unknown) {
  if (typeof slotId !== "string" || !mediaSlots.some(slot => slot.id === slotId)) throw new MediaValidationError("展示位置不存在。");
  const document = await client.getDocument(publishedPlacementId(slotId));
  if (!document) return null;
  if (document._type !== "mediaPlacement" || document.slotId !== slotId ||
    !["image", "video"].includes(document.kind) || typeof document._rev !== "string" ||
    !document._rev.length || document._rev.length > 256 || /\s/.test(document._rev)) throw new MediaValidationError("公开内容记录无效。");
  const kind = document.kind as "image" | "video";
  const placement = validatePlacement({ slotId, assetId: document.assetId, alt: document.alt, caption: document.caption }, kind);
  return { revision: document._rev, placement, kind, variants: publicMediaVariants(placement.assetId, kind, document.variants) };
}
