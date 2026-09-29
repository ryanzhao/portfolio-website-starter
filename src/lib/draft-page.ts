import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { SanityClient } from "@sanity/client";
import type { SlotMedia } from "./public-content.ts";
import { mediaSlots, MediaValidationError } from "./media.ts";
import { readPlacementDraft } from "./placement-draft.ts";
import { readPlacementCandidate } from "./placement-candidate.ts";
import { readPublishedPlacement } from "./published-placement.ts";

// Authenticate before calling; never cache this response or use it on public routes.
export async function readDraftPage(db: D1Database, bucket: R2Bucket, client: Pick<SanityClient, "getDocument">, owner: string, path: unknown) {
  const slots = mediaSlots.filter(slot => slot.path === path);
  if (typeof path !== "string" || !slots.length) throw new MediaValidationError("预览页面不存在。");
  const media: Record<string, SlotMedia> = {};
  const revisions: Record<string, string> = {};
  const publicRevisions: Record<string, string | null> = {};
  await Promise.all(slots.map(async slot => {
    const draft = await readPlacementDraft(client, slot.id);
    if (!draft.placement) return;
    const candidate = await readPlacementCandidate(db, bucket, client, owner, slot.id, draft.revision);
    const url = (role: string) => `/api/admin/media?assetId=${encodeURIComponent(candidate.placement.assetId)}&role=${role}`;
    media[slot.id] = { kind: candidate.kind, src: url(candidate.kind === "image" ? "detail" : "video"),
      ...(candidate.kind === "video" ? { poster: url("poster") } : {}), alt: candidate.placement.alt, caption: candidate.placement.caption };
    revisions[slot.id] = candidate.revision!;
    publicRevisions[slot.id] = (await readPublishedPlacement(client, slot.id))?.revision ?? null;
  }));
  return { path, media, revisions, publicRevisions };
}
