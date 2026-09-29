import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { SanityClient } from "@sanity/client";
import type { SlotMedia } from "./public-content.ts";
import { mediaSlots, MediaValidationError } from "./media.ts";
import { readPlacementDraft } from "./placement-draft.ts";
import { readPlacementCandidate } from "./placement-candidate.ts";
import { readPublishedPlacement } from "./published-placement.ts";
import { readUpload } from "./uploads.ts";

export type EditorState = { status: "empty" | "published" | "draft" | "pending" | "error"; message: string };

// Authenticated callers only. A broken/pending slot must not hide the remaining page.
export async function readEditorPage(db: D1Database, bucket: R2Bucket, client: Pick<SanityClient, "getDocument">, owner: string, path: unknown) {
  const slots = mediaSlots.filter(slot => slot.path === path);
  if (typeof path !== "string" || !slots.length) throw new MediaValidationError("编辑页面不存在。");
  const media: Record<string, SlotMedia | null> = {};
  const states: Record<string, EditorState> = {};
  const publishSlots: { id: string; label: string; revision: string; previousRevision: string | null }[] = [];
  await Promise.all(slots.map(async slot => {
    media[slot.id] = null;
    try {
      const draft = await readPlacementDraft(client, slot.id);
      if (!draft.placement) {
        const published = await readPublishedPlacement(client, slot.id);
        if (published) {
          const url = (role: string) => `/api/media?key=${encodeURIComponent(published.variants.find(file => file.role === role)!.key)}`;
          media[slot.id] = { kind: published.kind, src: url(published.kind === "image" ? "detail" : "video"),
            ...(published.kind === "video" ? { poster: url("poster") } : {}), alt: published.placement.alt, caption: published.placement.caption };
        }
        states[slot.id] = { status: published ? "published" : "empty", message: published ? "已发布" : "等待添加素材" };
        return;
      }
      await readUpload(db, owner, draft.placement.assetId);
      const job = await db.prepare("SELECT status, resultManifest FROM processing_jobs WHERE assetId = ?").bind(draft.placement.assetId).first<{ status: string; resultManifest: string }>();
      if (job?.status !== "ready") {
        states[slot.id] = { status: job?.status === "failed" ? "error" : "pending", message: job?.status === "failed" ? "处理失败，请到高级管理检查" : "草稿已保存，等待电脑处理" };
        return;
      }
      const candidate = await readPlacementCandidate(db, bucket, client, owner, slot.id, draft.revision);
      const url = (role: string) => `/api/admin/media?assetId=${encodeURIComponent(candidate.placement.assetId)}&role=${role}`;
      media[slot.id] = { kind: candidate.kind, src: url(candidate.kind === "image" ? "detail" : "video"),
        ...(candidate.kind === "video" ? { poster: url("poster") } : {}), alt: candidate.placement.alt, caption: candidate.placement.caption };
      const published = await readPublishedPlacement(client, slot.id);
      const files = JSON.parse(job.resultManifest).files as { key: string }[];
      if (published?.kind === candidate.kind && published.placement.assetId === candidate.placement.assetId &&
        published.placement.alt === candidate.placement.alt && published.placement.caption === candidate.placement.caption &&
        files.length === published.variants.length && files.every(file => published.variants.some(variant => variant.key === file.key))) {
        states[slot.id] = { status: "published", message: "已发布 · 与当前草稿一致" };
        return;
      }
      states[slot.id] = { status: "draft", message: "私有草稿 · 尚未发布本次更改" };
      publishSlots.push({ id: slot.id, label: slot.label, revision: candidate.revision!, previousRevision: published?.revision ?? null });
    } catch {
      states[slot.id] = { status: "error", message: "此位置读取失败，请刷新核对；未覆盖内容" };
    }
  }));
  publishSlots.sort((a, b) => slots.findIndex(slot => slot.id === a.id) - slots.findIndex(slot => slot.id === b.id));
  return { path, media, states, publishSlots };
}
