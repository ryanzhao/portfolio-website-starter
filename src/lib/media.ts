import { portfolioSections } from "./portfolio.ts";

export type MediaKind = "image" | "video" | "model";
export type MediaSlot = { id: string; label: string; kinds: readonly MediaKind[]; path: string };
export const mediaSlots: MediaSlot[] = [
  { id: "home.hero", label: "首页 · 首屏主图", kinds: ["image"], path: "/" },
  { id: "home.portrait", label: "首页 · 个人介绍照片", kinds: ["image"], path: "/" },
  ...portfolioSections.map(s => ({ id: `home.${s.slug}`, label: `首页 · ${s.title}`, kinds: ["image", "video"] as const, path: "/" })),
  { id: "home.electronics.secondary", label: "首页 · 电子系统第二张图", kinds: ["image"], path: "/" },
  ...portfolioSections.flatMap(s => [
    { id: `work.${s.slug}.hero`, label: `${s.title} · 专题主图/视频`, kinds: ["image", "video"] as const, path: `/work/${s.slug}` },
    ...s.projects.map((title, i) => ({ id: `work.${s.slug}.project.${i + 1}`, label: `${s.title} · ${title}`, kinds: ["image", "video"] as const, path: `/work/${s.slug}` })),
    ...(s.projects.length ? [] : [{ id: `work.${s.slug}.activity`, label: `${s.title} · 活动记录`, kinds: ["image", "video"] as const, path: `/work/${s.slug}` }]),
  ]),
];

export const uploadLimits = { image: 50 * 1024 * 1024, video: 2 * 1024 * 1024 * 1024, model: 2 * 1024 * 1024 * 1024 };
const formats: Record<string, { kind: MediaKind; extension: RegExp }> = {
  "model/gltf-binary": { kind: "model", extension: /\.glb$/i },
  "model/step": { kind: "model", extension: /\.(step|stp)$/i },
  "image/jpeg": { kind: "image", extension: /\.jpe?g$/i },
  "image/png": { kind: "image", extension: /\.png$/i },
  "image/webp": { kind: "image", extension: /\.webp$/i },
  "video/mp4": { kind: "video", extension: /\.mp4$/i },
  "video/webm": { kind: "video", extension: /\.webm$/i },
};

export class MediaValidationError extends Error {
  constructor(message: string) { super(message); this.name = "MediaValidationError"; }
}

// Sanity IDs containing dots are private, even in a public dataset.
// Keep existing private draft IDs unchanged; only published records use root IDs.
export function publishedPlacementId(slotId: unknown): string {
  if (typeof slotId !== "string" || !mediaSlots.some(slot => slot.id === slotId) || !/^[a-z0-9.-]+$/.test(slotId)) {
    throw new MediaValidationError("展示位置不存在。");
  }
  return `placement-${slotId.replaceAll(".", "_")}`;
}

function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new MediaValidationError("请求字段无效。");
  }
  return value as Record<string, unknown>;
}

// This checks declarations only. Upload completion must independently inspect
// stored bytes, length and processing results before marking an asset ready.
export function validateUpload(value: unknown, limits = uploadLimits) {
  const input = object(value, ["filename", "mimeType", "size"]);
  const { filename, mimeType, size } = input;
  const format = typeof mimeType === "string" && Object.hasOwn(formats, mimeType) ? formats[mimeType] : undefined;
  if (typeof filename !== "string" || !filename.trim() || filename.length > 240 ||
    /[\\/:\x00-\x1f\x7f]/.test(filename) || !format || !format.extension.test(filename)) {
    throw new MediaValidationError("请选择 JPEG、PNG、WebP 图片、MP4、WebM 视频或 GLB、STEP、STP 模型，文件名不能包含路径。");
  }
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) throw new MediaValidationError("文件为空或大小无效。");
  const maximum = mimeType === "model/gltf-binary" ? Math.min(limits.model, 50 * 1024 ** 2) : limits[format.kind];
  if (size > maximum) throw new MediaValidationError(`文件为 ${(size / 1048576).toFixed(1)} MiB，超过此类型的单文件上限 ${(maximum / 1048576).toFixed(0)} MiB。`);
  return { filename, mimeType: mimeType as string, size, kind: format.kind };
}

export type MediaPlacement = { slotId: string; assetId: string; alt: string; caption: string };
export function validatePlacement(value: unknown, kind: MediaKind): MediaPlacement {
  const input = object(value, ["slotId", "assetId", "alt", "caption"]);
  const slot = mediaSlots.find(slot => slot.id === input.slotId);
  if (!slot || !slot.kinds.includes(kind)) throw new MediaValidationError("展示位置不存在或不支持此素材类型。");
  if (typeof input.assetId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.assetId)) {
    throw new MediaValidationError("素材标识无效。");
  }
  if (typeof input.alt !== "string" || !input.alt.trim() || input.alt.length > 300 ||
    typeof input.caption !== "string" || input.caption.length > 2000) {
    throw new MediaValidationError("请填写不超过 300 字的替代说明，图注不超过 2000 字。");
  }
  return { slotId: slot.id, assetId: input.assetId, alt: input.alt.trim(), caption: input.caption.trim() };
}
