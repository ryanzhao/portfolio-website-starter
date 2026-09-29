import { UploadError } from "./uploads.ts";

export function mediaRange(header: string | null | undefined, size: number) {
  if (header === undefined || header === null) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new UploadError(416, "读取范围无效。");
  const first = Number(match[1]), last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) throw new UploadError(416, "读取范围无效。");
  const offset = match[1] ? first : Math.max(0, size - last);
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
  if (offset >= size || end < offset) throw new UploadError(416, "读取范围无效。");
  return { offset, length: end - offset + 1 };
}
