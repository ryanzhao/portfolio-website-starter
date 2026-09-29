import sharp from "sharp";
import { createHash } from "node:crypto";

// PC-only module. Do not import native sharp into the Workers application.
export async function imageVariants(original) {
  if (!Buffer.isBuffer(original) || !original.length || original.length > 50 * 1024 * 1024) {
    throw new Error("图片原文件为空或超过 50 MiB。");
  }
  const options = { failOn: "warning", limitInputPixels: 40_000_000 };
  const metadata = await sharp(original, options).metadata();
  if (!["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages ?? 1) !== 1) {
    throw new Error("仅支持静态 JPEG、PNG、WebP 图片。");
  }
  const width = metadata.autoOrient.width;
  const widths = [Math.min(480, width), Math.min(1600, width)];
  const variants = [];
  for (const [index, target] of widths.entries()) {
    const role = index === 0 ? "thumbnail" : "detail";
    if (index === 1 && widths[0] === target) {
      variants.push({ ...variants[0], role });
      continue;
    }
    // Default output strips metadata; autoOrient applies camera orientation first.
    const { data, info } = await sharp(original, options).autoOrient()
      .resize({ width: target, withoutEnlargement: true }).webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    variants.push({ role, size: data.length, bytes: data, width: info.width, height: info.height,
      mimeType: "image/webp", sha256: createHash("sha256").update(data).digest("hex") });
  }
  return variants;
}
