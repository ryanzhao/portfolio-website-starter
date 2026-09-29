export const MEDIA_UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/webm,.step,.stp,model/step,.glb,model/gltf-binary";
export function uploadMimeType(file: Pick<File, "name" | "type">) {
  if (/\.glb$/i.test(file.name) && ["", "application/octet-stream", "model/gltf-binary"].includes(file.type)) return "model/gltf-binary";
  return /\.(step|stp)$/i.test(file.name) && ["", "application/octet-stream", "model/step"].includes(file.type) ? "model/step" : file.type;
}

type UploadOptions = { fetch?: typeof fetch; signal?: AbortSignal; resume?: boolean; onProgress?: (bytes: number) => void };

export async function uploadFiles(items: { id: string; file: File }[], options: Omit<UploadOptions, "onProgress"> & {
  onProgress?: (id: string, bytes: number) => void;
  onResult: (id: string, error: string | null) => void;
}) {
  for (const { id, file } of items) {
    if (options.signal?.aborted) break;
    try {
      const result = await uploadFile(file, id, { fetch: options.fetch, signal: options.signal,
        onProgress: bytes => options.onProgress?.(id, bytes) });
      if (result.status !== "processing_pending") throw new Error("上传结果尚未确认，请刷新素材列表核对，勿重复上传。");
      options.onResult(id, null);
    } catch (error) {
      options.onResult(id, options.signal?.aborted ? "已停止，服务器可能保留会话或原件；请刷新素材列表核对。" :
        error instanceof Error ? error.message : "上传失败，请核对素材记录。");
    }
  }
}

export async function uploadFile(file: File, id: string, options: UploadOptions = {}) {
  const transport = options.fetch ?? fetch;
  const mimeType = uploadMimeType(file);
  const send: typeof fetch = async (url, init) => {
    for (let attempt = 0; ; attempt++) {
      options.signal?.throwIfAborted();
      try {
        const response = await transport(url, init);
        if (attempt === 2 || ![408, 500, 502, 503, 504].includes(response.status)) return response;
        await response.body?.cancel();
      } catch (error) {
        if (options.signal?.aborted || !(error instanceof TypeError) || attempt === 2) throw error;
      }
      // Bounded retry of the same idempotent control message or multipart PUT.
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(options.signal?.reason); };
        const timer = setTimeout(() => { options.signal?.removeEventListener("abort", abort); resolve(); }, 500 * 2 ** attempt);
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) { options.signal.removeEventListener("abort", abort); abort(); }
      });
    }
  };
  const control = async (body: object) => {
    const response = await send("/api/admin/uploads", { method: "POST", credentials: "same-origin",
      cache: "no-store", signal: options.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "上传请求失败。");
    return data;
  };
  if (options.resume) {
    const state = await control({ action: "read", id });
    if (state.filename !== file.name || state.mimeType !== mimeType || state.size !== file.size) throw new Error("请选择原上传文件，名称、类型或大小不匹配。");
    if (state.status === "processing_pending") return state;
    if (state.status === "completing") return control({ action: "recover", id });
    if (state.status !== "uploading") throw new Error("此任务不能直接续传，请核对服务器状态。");
  } else {
    await control({ action: "begin", id, file: { filename: file.name, mimeType, size: file.size } });
  }
  const parts: { partNumber: number; etag: string }[] = [];
  options.onProgress?.(0);
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 2147483648) throw new Error("文件大小无效。");
  const hashes: string[] = [];
  // Hash the entire file before resuming, but retain at most one 8 MiB part in memory.
  for (let start = 0; start < file.size; start += 8388608) {
    options.signal?.throwIfAborted();
    const digest = await crypto.subtle.digest("SHA-256", await file.slice(start, start + 8388608).arrayBuffer());
    hashes.push(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""));
  }
  const saved = await control({ action: "prepare", id, hashes });
  const receipts = new Map<number, string>();
  if (!Array.isArray(saved.parts) || saved.parts.length > hashes.length) throw new Error("续传分片记录无效。");
  for (const part of saved.parts) {
    if (!part || !Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > hashes.length ||
      receipts.has(part.partNumber) || typeof part.etag !== "string" || !part.etag.length || part.etag.length > 256 || /[\x00-\x20\x7f]/.test(part.etag)) throw new Error("续传分片记录无效。");
    receipts.set(part.partNumber, part.etag);
  }
  let offset = 0;
  while (offset < file.size) {
    const partNumber = parts.length + 1;
    const previous = receipts.get(partNumber);
    if (previous) {
      parts.push({ partNumber, etag: previous });
      offset += Math.min(8388608, file.size - offset);
      options.onProgress?.(offset);
      continue;
    }
    const grant = await control({ action: "part", id, partNumber });
    const url = new URL(grant.url);
    if (url.protocol !== "https:" || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.host) ||
      url.username || url.password || url.pathname !== `/openmpd/originals/${id}` || grant.method !== "PUT" ||
      grant.offset !== offset || !Number.isSafeInteger(grant.length) || grant.length < 1 ||
      grant.length > 8388608 || offset + grant.length > file.size) throw new Error("上传分片授权无效。");
    const response = await send(url.href, { method: "PUT", credentials: "omit", redirect: "error",
      signal: options.signal, body: file.slice(offset, offset + grant.length) });
    if (!response.ok) throw new Error(`分片上传失败（${response.status}）。`);
    const etag = response.headers.get("etag");
    if (!etag || etag.length > 256 || /[\x00-\x20\x7f]/.test(etag)) throw new Error("无法读取上传回执，请检查存储跨域配置。");
    const receipt = await control({ action: "receipt", id, partNumber, etag });
    if (receipt.saved !== true) throw new Error("分片回执保存尚未确认，请核对任务后续传。");
    parts.push({ partNumber, etag });
    offset += grant.length;
    options.onProgress?.(offset);
  }
  return control({ action: "complete", id, parts });
}
