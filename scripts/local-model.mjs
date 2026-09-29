import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, stat, readFile, readdir } from "node:fs/promises";
import { resolve, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validateModelGlb } from "../src/lib/model-glb.ts";
import { uploadLimits } from "../src/lib/media.ts";

const execute = promisify(execFile);
const maximum = 50 * 1024 ** 2;

export async function isStepFile(path) {
  const file = await open(path, "r");
  try {
    const prefix = Buffer.alloc(256);
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    return /^\s*ISO-10303-21\s*;/i.test(prefix.subarray(0, bytesRead).toString("ascii"));
  } finally { await file.close(); }
}

// One isolated converter process; originals and failed outputs stay private.
export async function modelVariants(input, outputDir, { signal } = {}) {
  signal?.throwIfAborted();
  const python = process.env.STEP_PYTHON_PATH;
  if (!python || !isAbsolute(python)) throw new Error("请配置本机 STEP_PYTHON_PATH（带 CadQuery 的 Python 完整路径）。");
  const source = resolve(input), path = join(resolve(outputDir), "model.glb");
  const info = await stat(source);
  if (!info.isFile() || info.size <= 0 || info.size > uploadLimits.model || !await isStepFile(source)) throw new Error("STEP 文件无效或超过 2 GiB。");
  const lock = await open(join(resolve(outputDir), ".processing"), "wx");
  await lock.close();
  const limit = new AbortController();
  const boundedSignal = signal ? AbortSignal.any([signal, limit.signal]) : limit.signal;
  let inspecting;
  // Windows has no per-process file-size quota; check output growth every 100 ms.
  const timer = setInterval(() => {
    if (!inspecting) inspecting = (async () => {
      let size = 0;
      for (const name of await readdir(outputDir)) {
        const candidate = join(resolve(outputDir), name);
        if (candidate === source || name === ".processing") continue;
        size += (await stat(candidate).catch(error => { if (error.code === "ENOENT") return { size: 0 }; throw error; })).size;
      }
      if (size > maximum) limit.abort();
    })().catch(() => limit.abort()).finally(() => { inspecting = undefined; });
  }, 100);
  try {
    await execute(python, ["-I", fileURLToPath(new URL("./step-to-glb.py", import.meta.url)), source, path], {
      windowsHide: true, timeout: 600000, signal: boundedSignal, maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new Error(signal?.aborted ? "模型处理已停止。" : "STEP 转换失败或超时；原件保留，请检查本机工具及模型复杂度。");
  } finally { clearInterval(timer); await inspecting; }
  boundedSignal.throwIfAborted();
  signal?.throwIfAborted();
  const output = await stat(path);
  if (!output.isFile() || output.size <= 0 || output.size > maximum) throw new Error("模型结果超过 50 MiB 或为空。");
  const bytes = await readFile(path);
  validateModelGlb(bytes);
  return { files: [{ path, role: "model", mimeType: "model/gltf-binary", size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") }] };
}
