import type { D1Database } from "@cloudflare/workers-types";
import { UploadError } from "./uploads.ts";

const limits = { uploads: 1200, drafts: 60, publication: 10 };

export async function requireWriteAllowance(db: D1Database, owner: string, category: keyof typeof limits, now = Date.now()) {
  if (!db || !owner || owner.length > 256 || !Object.hasOwn(limits, category) || !Number.isSafeInteger(now) || now < 0) {
    throw new UploadError(503, "写入保护暂时不可用，请稍后重试。");
  }
  const window = Math.floor(now / 60000);
  let result;
  try {
    // ponytail: fixed-minute windows allow a boundary burst; use a sliding window if traffic requires it.
    result = await db.prepare(`INSERT INTO admin_write_limits(owner, category, window, count) VALUES (?, ?, ?, 1)
      ON CONFLICT(owner, category) DO UPDATE SET window = MAX(window, excluded.window),
      count = CASE WHEN window < excluded.window THEN 1 ELSE count + 1 END
      WHERE window < excluded.window OR count < ? RETURNING count`)
      .bind(owner, category, window, limits[category]).first<{ count: number }>();
  } catch { throw new UploadError(503, "写入保护暂时不可用，请稍后重试。"); }
  if (!result) {
    const error = new UploadError(429, "操作过于频繁，请稍后重试；上传任务可重新选择原文件续传。");
    error.retryAfter = Math.max(1, Math.ceil(((window + 1) * 60000 - now) / 1000));
    throw error;
  }
}
