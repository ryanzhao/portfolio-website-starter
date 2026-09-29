import { MediaValidationError, type MediaKind } from "./media.ts";

// Project only display metadata; never forward arbitrary stored document fields.
export function publicMediaVariants(assetId: string, kind: MediaKind, input: unknown) {
  if (!Array.isArray(input)) throw new MediaValidationError("公开素材清单无效。");
  const declarations = input.map(value => {
    if (!value || typeof value !== "object") throw new MediaValidationError("公开素材无效。");
    const { role, mimeType, size, sha256, width, height, duration } = value;
    return { role, mimeType, size, sha256, ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}), ...(duration !== undefined ? { duration } : {}) };
  });
  const { files } = validateProcessingResult(assetId, kind, { files: declarations });
  if (files.some((file, index) => file.key !== input[index].key)) throw new MediaValidationError("公开素材路径不匹配。");
  return files;
}

// Declarations only. Stored bytes must be independently checked before readiness.
export function validateProcessingResult(assetId: string, kind: MediaKind, input: unknown) {
  const invalid = () => new MediaValidationError("处理结果清单无效。");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(assetId) ||
    !input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "files") ||
    !("files" in input) || !Array.isArray(input.files) || input.files.length !== (kind === "model" ? 1 : 2) || !["image", "video", "model"].includes(kind)) throw invalid();
  const roles = kind === "model" ? ["model"] : kind === "image" ? ["thumbnail", "detail"] : ["poster", "video"];
  const files = input.files.map((value: unknown, index: number) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
    const file = value as Record<string, unknown>;
    const isVideo = roles[index] === "video";
    const isModel = kind === "model";
    const allowed = ["role", "mimeType", "size", "sha256", ...(!isModel ? ["width", "height"] : []), ...(isVideo ? ["duration"] : [])];
    const positive = (value: unknown, max: number) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max;
    if (Object.keys(file).some(key => !allowed.includes(key)) || file.role !== roles[index] ||
      file.mimeType !== (isModel ? "model/gltf-binary" : isVideo ? "video/mp4" : "image/webp") || !positive(file.size, isVideo ? 2 * 1024 ** 3 : 50 * 1024 ** 2) ||
      (!isModel && (!positive(file.width, isVideo ? 1920 : 1600) || !positive(file.height, isVideo ? 1080 : 40000))) ||
      typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256) ||
      (isVideo && (typeof file.duration !== "number" || !Number.isFinite(file.duration) || file.duration <= 0))) throw invalid();
    return { role: roles[index], mimeType: file.mimeType as string, size: file.size as number,
      sha256: file.sha256, ...(!isModel ? { width: file.width as number, height: file.height as number } : {}),
      ...(isVideo ? { duration: file.duration as number } : {}),
      key: `derivatives/${assetId}/${file.sha256}/${roles[index]}.${isModel ? "glb" : isVideo ? "mp4" : "webp"}` };
  });
  return { files };
}
