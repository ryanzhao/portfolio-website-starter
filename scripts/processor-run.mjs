import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileTypeFromFile } from "file-type";
import { downloadSource, processorHeaders } from "./processor-download.mjs";
import { imageVariants } from "./local-images.mjs";
import { videoVariants } from "./local-video.mjs";
import { isStepFile, modelVariants } from "./local-model.mjs";
import { uploadResultFile } from "./processor-upload.mjs";
import { validateProcessingResult } from "../src/lib/processing-result.ts";
import { validateModelGlb, MAX_MODEL_BYTES } from "../src/lib/model-glb.ts";
import { createHash } from "node:crypto";

// One job per invocation; no scheduler or cloud provisioning is installed here.
export async function runProcessorJob(origin, token, directory, options = {}) {
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) ||
    !/^[a-f0-9]{64}$/.test(token)) throw new Error("处理地址或密钥无效。");
  if (!(await stat(directory)).isDirectory()) throw new Error("请提供私有工作目录。");
  const headers = processorHeaders(origin, token, options.access);
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const transport = options.fetch ?? fetch;
  const control = async body => {
    signal.throwIfAborted();
    const response = await transport(`${origin}/api/processor`, { method: "POST", redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      headers, body: JSON.stringify(body) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("处理请求未确认；请检查后台任务状态。"); }
    return response.json();
  };
  const { job } = await control({ action: "claim" });
  if (job === null) return null;
  const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
  if (!job || !uuid(job.assetId) || !uuid(job.leaseToken) || job.status !== "running") throw new Error("处理任务无效。");
  const identity = { assetId: job.assetId, leaseToken: job.leaseToken };
  let renewal;
  const timer = setInterval(() => {
    if (!renewal) renewal = control({ action: "renew", ...identity })
      .catch(() => controller.abort(new Error("处理租约续期失败，已停止后续传输。")))
      .finally(() => { renewal = undefined; });
  }, 60000);
  timer.unref();
  try {
    const jobDirectory = await mkdtemp(join(directory, `${job.assetId}-`));
    const source = join(jobDirectory, "original");
    await downloadSource(origin, token, job, source, { fetch: transport, signal, access: options.access });
    const type = await fileTypeFromFile(source);
    let files, kind;
    if (["image/jpeg", "image/png", "image/webp"].includes(type?.mime)) {
      kind = "image";
      if ((await stat(source)).size > 50 * 1024 ** 2) throw new Error("图片超过处理上限。");
      files = [];
      for (const { bytes, ...file } of await imageVariants(await readFile(source))) {
        signal.throwIfAborted();
        const path = join(jobDirectory, `${file.role}.webp`);
        await writeFile(path, bytes, { flag: "wx" });
        files.push({ ...file, path });
      }
    } else if (["video/mp4", "video/webm"].includes(type?.mime)) {
      kind = "video";
      ({ files } = await videoVariants(source, jobDirectory, { signal }));
    } else if (type?.mime === "model/gltf-binary") {
      kind = "model";
      if ((await stat(source)).size > MAX_MODEL_BYTES) throw new Error("GLB 超过 50 MiB。");
      const bytes = await readFile(source);
      validateModelGlb(bytes);
      files = [{ path: source, role: "model", mimeType: "model/gltf-binary", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }];
    } else if (await isStepFile(source)) {
      kind = "model";
      ({ files } = await modelVariants(source, jobDirectory, { signal }));
    } else throw new Error("原文件类型不支持。");
    const declaration = { files: files.map(file => Object.fromEntries(Object.entries(file).filter(([key]) => key !== "path"))) };
    const expected = validateProcessingResult(job.assetId, kind, declaration);
    const registered = await control({ action: "register", ...identity, result: declaration });
    if (JSON.stringify(registered.result) !== JSON.stringify(expected)) throw new Error("后台处理清单不匹配。");
    for (const file of expected.files) {
      const grant = await control({ action: "authorize-result", ...identity, role: file.role });
      await uploadResultFile({ ...file, path: files.find(local => local.role === file.role).path }, grant, { fetch: transport, signal });
    }
    const completed = await control({ action: "complete", ...identity });
    if (completed.job?.assetId !== job.assetId || completed.job?.status !== "ready" || completed.published !== false) throw new Error("处理结果尚未确认。");
    return { assetId: job.assetId, status: "ready", published: false, directory: jobDirectory };
  } catch (error) {
    if (!signal.aborted) await control({ action: "fail", ...identity, error: "本机处理失败；原件保留，请检查处理器配置或素材后重试。" }).catch(() => {});
    throw error;
  } finally {
    clearInterval(timer);
    controller.abort();
    await renewal;
  }
}
