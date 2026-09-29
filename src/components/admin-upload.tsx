"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { uploadFile, uploadFiles, uploadMimeType, MEDIA_UPLOAD_ACCEPT } from "@/lib/upload-client";
import { AdminPlacement } from "./admin-placement";
import type { MediaKind } from "@/lib/media";

type QueueItem = { id: string; file: File; bytes: number; status: "queued" | "uploading" | "ready" | "error"; error?: string };
type LibraryItem = { id: string; kind: MediaKind; filename: string; status: string; processingStatus: string | null };

async function readLibrary(offset = 0, signal?: AbortSignal) {
  const response = await fetch(`/api/admin/uploads?offset=${offset}`, { credentials: "same-origin", cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "无法读取素材记录。");
  if (!Array.isArray(data.items)) throw new Error("素材列表格式无效。");
  return data as { items: LibraryItem[]; nextOffset: number | null };
}

export function AdminUpload() {
  const [authenticated, setAuthenticated] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState<{ id: string; kind: MediaKind } | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [resuming, setResuming] = useState<{ filename: string; bytes: number; size: number } | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [message, setMessage] = useState("正在检查管理员身份…");
  const active = useRef<AbortController | null>(null);
  const running = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/session", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (controller.signal.aborted) return;
        setAuthenticated(response.ok && data.authenticated === true);
        setMessage(response.ok && data.authenticated === true ? "身份已验证。上传原文件保持私有，预览并确认发布后才会公开。" : data.error || "请先登录后台。");
        if (response.ok && data.authenticated === true) {
          setLibraryBusy(true);
          try {
            const records = await readLibrary(0, controller.signal);
            if (!controller.signal.aborted) { setLibrary(records.items); setNextOffset(records.nextOffset); }
          } catch { if (!controller.signal.aborted) setMessage("身份已验证，但素材记录读取失败，请点击刷新素材列表。"); }
          finally { if (!controller.signal.aborted) setLibraryBusy(false); }
        }
      }).catch(() => { if (!controller.signal.aborted) setMessage("无法检查身份，请刷新页面重试。"); });
    return () => { controller.abort(); active.current?.abort(); };
  }, []);
  async function loadLibrary(offset = 0) {
    if (libraryBusy || !authenticated) return;
    setLibraryBusy(true);
    try {
      const data = await readLibrary(offset);
      setLibrary(data.items); setNextOffset(data.nextOffset);
      setMessage(data.items.length ? "已读取素材记录。只有完成初步校验的素材可以设置位置；仍不代表可发布。" : "暂无素材记录。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法读取素材记录。"); }
    finally { setLibraryBusy(false); }
  }
  async function resume(item: LibraryItem, file?: File) {
    if (!authenticated || running.current) return;
    running.current = true;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setMessage(file ? "正在核对原文件内容，随后只补传缺失分片；核对期间进度可能保持为零。" : "正在重试服务器已保存的完成校验，不会重新上传文件。");
    try {
      let result;
      if (file) {
        setResuming({ filename: file.name, bytes: 0, size: file.size });
        result = await uploadFile(file, item.id, { resume: true, signal: controller.signal,
          onProgress: bytes => setResuming({ filename: file.name, bytes, size: file.size }) });
      } else {
        const response = await fetch("/api/admin/uploads", { method: "POST", credentials: "same-origin", cache: "no-store",
          signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "recover", id: item.id }) });
        result = await response.json();
        if (!response.ok) throw new Error(result.error || "完成校验暂未成功，请稍后重试。");
      }
      if (result.status !== "processing_pending") throw new Error("结果尚未确认，请刷新素材列表核对。");
      setLibrary(items => items.map(record => record.id === item.id ? { ...record, status: result.status } : record));
      setUploaded({ id: item.id, kind: item.kind });
      setMessage("原件已接收，可设置展示位置；仍需电脑处理，不会自动发布。");
    } catch (error) {
      setMessage(controller.signal.aborted ? "传输已停止。已确认的分片保留，可重新选择原文件续传。" : error instanceof Error ? error.message : "续传失败，请刷新素材列表核对。");
    } finally { running.current = false; active.current = null; setBusy(false); setResuming(null); }
  }
  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending = queue.filter(item => item.status === "queued");
    if (!pending.length || !authenticated || running.current) return;
    running.current = true;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setMessage("正在逐个上传私有原文件，结果显示在各文件下方；不会自动发布。");
    try {
      await uploadFiles(pending, { signal: controller.signal,
        onProgress: (id, bytes) => setQueue(items => items.map(item => item.id === id ? { ...item, bytes, status: "uploading" } : item)),
        onResult: (id, error) => setQueue(items => items.map(item => item.id === id ? { ...item, status: error === null ? "ready" : "error", error: error ?? undefined } : item)),
      });
      setMessage(controller.signal.aborted ? "已停止当前传输，后续文件未上传。停止不等于删除；可继续上传尚未开始的文件。" : "本批上传已结束，请逐项核对结果。成功项可设置位置，处理和发布仍需后续操作。");
    } catch (error) {
      setMessage(controller.signal.aborted ? "已停止传输。服务器可能仍保留上传会话或原文件；停止不等于删除。" :
        error instanceof Error ? error.message : "上传失败，请稍后重试。");
    } finally { running.current = false; setBusy(false); active.current = null; }
  }
  return <div className="notice" aria-labelledby="upload-heading">
    <h2 id="upload-heading">上传照片、视频或 GLB / STEP 模型</h2>
    <p>照片支持 JPEG、PNG、WebP（最多 50 MiB）；视频支持 MP4、WebM（最多 2 GiB）。GLB 最多 50 MiB，需电脑在线校验；STEP / STP 模型最多 2 GiB，需电脑在线转换；上传不会自动发布。</p>
    <form onSubmit={start}>
      <label htmlFor="admin-media-file">选择文件</label>
      <input id="admin-media-file" type="file" multiple accept={MEDIA_UPLOAD_ACCEPT}
        disabled={!authenticated || busy} className="block max-w-full my-4"
        onChange={event => setQueue(Array.from(event.target.files ?? [], file => ({ id: crypto.randomUUID(), file, bytes: 0, status: "queued" })))} />
      <p>可一次选择多个文件，按顺序上传；一个失败不会阻塞后续文件。重新选择文件会替换本页队列，已上传的记录仍保留。</p>
      <div className="flex flex-wrap gap-3">
        <button className="feature-button disabled:opacity-50" type="submit" disabled={!authenticated || !queue.some(item => item.status === "queued") || busy}>上传私有原文件</button>
        {busy && <button className="feature-button" type="button" onClick={() => active.current?.abort()}>停止传输</button>}
      </div>
    </form>
    <ul className="my-4 space-y-3" aria-label="本次上传队列">
      {queue.map(item => <li key={item.id} className="break-words">
        <p>{item.file.name} · {(item.file.size / 1048576).toFixed(2)} MiB</p>
        <p>{({ queued: "等待上传", uploading: "正在上传或校验", ready: "原件已接收，等待电脑处理；尚未发布", error: "上传未完成" })[item.status]}{item.error && `：${item.error}`}</p>
        {item.status === "uploading" && <><label htmlFor={`progress-${item.id}`}>已确认上传 {Math.floor(item.bytes / (item.file.size || 1) * 100)}%</label><progress className="block w-full" id={`progress-${item.id}`} value={item.bytes} max={item.file.size || 1} /></>}
        {item.status === "ready" && <button type="button" className="feature-button" onClick={() => setUploaded({ id: item.id, kind: ["model/step", "model/gltf-binary"].includes(uploadMimeType(item.file)) ? "model" : item.file.type.startsWith("image/") ? "image" : "video" })}>设置展示位置：{item.file.name}</button>}
      </li>)}
    </ul>
    {resuming && <div className="my-4 break-words"><label htmlFor="resume-progress">{resuming.filename} · 核对或续传中，已确认 {Math.floor(resuming.bytes / (resuming.size || 1) * 100)}%</label>
      <progress className="block w-full" id="resume-progress" value={resuming.bytes} max={resuming.size || 1} /></div>}
    <p role="status" aria-live="polite" className="break-words">{message}</p>
    <section aria-labelledby="library-heading" className="mt-8">
      <h3 id="library-heading">我的素材记录</h3>
      <button type="button" className="feature-button disabled:opacity-50" disabled={!authenticated || libraryBusy} onClick={() => loadLibrary()}>刷新素材列表</button>
      <ul className="my-4 space-y-3">
        {library.map(item => <li key={item.id} className="break-all">
          <span>{item.filename} · {({ uploading: "上传中", completing: "校验中", processing_pending: "原件已校验", rejected: "校验未通过", cancelling: "取消中", cancelled: "已取消" } as Record<string, string>)[item.status] || "未知状态"}</span>
          {item.status === "processing_pending" && <span> · {({ pending: "处理排队中", running: "电脑正在处理", failed: "处理失败", ready: "处理完成，可私有预览（未发布）" } as Record<string, string>)[item.processingStatus || ""] || "等待电脑领取处理任务"}</span>}
          {item.status === "processing_pending" && <button type="button" className="feature-button ml-2"
            onClick={() => setUploaded({ id: item.id, kind: item.kind })}>设置位置</button>}
          {item.status === "uploading" && <div className="my-2">
            <label htmlFor={`resume-${item.id}`}>重新选择原文件并续传：{item.filename}</label>
            <input id={`resume-${item.id}`} type="file" className="block max-w-full my-2" disabled={busy || libraryBusy}
              accept={item.kind === "model" ? ".glb,model/gltf-binary,.step,.stp,model/step" : item.kind === "image" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm"}
              onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void resume(item, file); }} />
          </div>}
          {item.status === "completing" && <button type="button" className="feature-button ml-2" disabled={busy || libraryBusy}
            onClick={() => resume(item)}>重试完成校验：{item.filename}</button>}
        </li>)}
      </ul>
      {nextOffset !== null && <button type="button" className="feature-button" disabled={libraryBusy} onClick={() => loadLibrary(nextOffset)}>下一页</button>}
    </section>
    {uploaded && (uploaded.kind === "model" ? <p>模型原件已保存。请在<Link href="/admin/design">网站设计器</Link>的素材库中使用此模型；处理完成后可预览。</p> : <AdminPlacement key={uploaded.id} assetId={uploaded.id} kind={uploaded.kind} />)}
    <p className="fine-print">刷新后会读取服务器素材记录；上传中任务需重新选择原文件，核对内容后仅补传缺失分片。尚未开始的本页队列不会保留。旧版任务没有分片记录时会重新传输全部分片；过期任务无法续传。处理完成后可保存草稿并打开整页预览；发布需逐项勾选确认。</p>
  </div>;
}
