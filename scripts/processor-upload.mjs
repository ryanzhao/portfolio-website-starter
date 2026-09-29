import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

export async function uploadResultFile(file, grant, options = {}) {
  const url = new URL(grant.url);
  if (url.protocol !== "https:" || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.host) ||
    url.username || url.password || url.pathname !== `/openmpd/${file.key}` ||
    !/^derivatives\/[a-f0-9-]{36}\/[a-f0-9]{64}\/(?:(thumbnail|detail|poster|video)\.(webp|mp4)|model\.glb)$/.test(file.key) ||
    grant.method !== "PUT" || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= Date.now() ||
    grant.headers?.["if-none-match"] !== "*" || grant.headers?.["content-length"] !== String(file.size) ||
    grant.headers?.["content-type"] !== file.mimeType) throw new Error("衍生文件上传授权无效。");
  const local = await stat(file.path);
  if (!local.isFile() || local.size !== file.size || local.size < 1 || local.size > 2 * 1024 ** 3) throw new Error("本机衍生文件大小已变化。");
  const body = createReadStream(file.path, { signal: options.signal });
  try {
    const response = await (options.fetch ?? fetch)(url.href, { method: "PUT", redirect: "error", duplex: "half",
      signal: options.signal, body, headers: { "content-length": String(file.size), "content-type": file.mimeType, "if-none-match": "*" } });
    await response.body?.cancel();
    if (!response.ok && response.status !== 412) throw new Error("衍生文件上传失败。");
    return { verificationRequired: true };
  } catch { throw new Error(options.signal?.aborted ? "衍生文件上传已停止。" : "衍生文件上传未确认，请核验存储状态后重试。"); }
  finally { body.destroy(); }
}
