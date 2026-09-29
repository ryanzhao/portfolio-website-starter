"use client";

import { useEffect, useRef, useState } from "react";
import type { LibraryItem } from "../lib/asset-library.ts";
import type { MediaKind } from "../lib/media.ts";
import { uploadFiles, MEDIA_UPLOAD_ACCEPT } from "../lib/upload-client.ts";
import { requireApiResponse } from "../lib/api-response.ts";

export function assetStatus(item: Pick<LibraryItem, "status" | "expiresAt" | "processingStatus">, now = Date.now()) {
  if (item.status === "processing_pending") return item.processingStatus === "ready" ? "已保存 · 可预览" : item.processingStatus === "failed" ? "已保存 · 处理失败" : item.processingStatus === "running" ? "电脑正在处理 / 转换" : "原件已保存 · 等待电脑处理";
  if (item.status === "uploading" && item.expiresAt <= now) return "上传已过期 · 请在高级管理核对";
  return { uploading: "上传未完成", completing: "等待完成校验", rejected: "校验未通过", cancelling: "取消处理中", cancelled: "已取消" }[item.status];
}

export function AdminLibrary({ kinds, onSelect, onBusyChange, onDirtyChange }: {
  kinds?: readonly MediaKind[]; onSelect?: (item: LibraryItem) => void;
  onBusyChange: (busy: boolean) => void; onDirtyChange: (dirty: boolean) => void;
}) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [query, setQuery] = useState({ q: "", kind: "", tag: "", offset: 0 });
  const [search, setSearch] = useState("");
  const [version, setVersion] = useState(0);
  const [checkedAt, setCheckedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [tagText, setTagText] = useState("");
  const [results, setResults] = useState<{ id: string; filename: string; message: string }[]>([]);
  const running = useRef(false);
  const upload = useRef<AbortController | null>(null);
  useEffect(() => () => upload.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams({ ...query, offset: String(query.offset) });
    fetch(`/api/admin/library?${params}`, { cache: "no-store", signal: abort.signal })
      .then(async response => {
        const data = await requireApiResponse(response).json();
        if (!response.ok) throw new Error(data.error || "素材目录读取失败。");
        if (abort.signal.aborted) return;
        setItems(previous => query.offset ? [...previous, ...data.items] : data.items);
        setCheckedAt(Date.now()); setNext(data.nextOffset); setTags(data.tags); setMessage("");
      }).catch(error => { if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "素材目录读取失败。"); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [query, version]);
  function refresh() { setLoading(true); setQuery(value => ({ ...value, offset: 0 })); setVersion(value => value + 1); }
  function working(value: boolean) { running.current = value; setBusy(value); onBusyChange(value); }
  async function batch(files: File[]) {
    if (running.current || !files.length) return;
    working(true); upload.current = new AbortController();
    const tasks = files.map(file => ({ id: crypto.randomUUID(), file }));
    setResults(tasks.map(({ id, file }) => ({ id, filename: file.name, message: "等待上传" })));
    const update = (id: string, message: string) => setResults(rows => rows.map(row => row.id === id ? { ...row, message } : row));
    try {
      await uploadFiles(tasks, { signal: upload.current.signal,
        onProgress: (id, bytes) => update(id, `已传输 ${(bytes / 1048576).toFixed(1)} MiB`),
        onResult: (id, error) => update(id, error || "原件已保存，等待电脑处理") });
    } finally { working(false); refresh(); }
  }
  async function retryProcessing(assetId: string) {
    if (running.current) return;
    working(true); setMessage("");
    try {
      const response = await fetch("/api/admin/library", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "retry-processing", assetId }) });
      const data = await requireApiResponse(response).json();
      if (!response.ok || data.queued !== true) throw new Error(data.error || "无法确认重试，请刷新目录核对。");
      refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "处理重试失败。"); }
    finally { working(false); }
  }
  async function saveTags(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || running.current) return;
    working(true); setMessage("");
    try {
      const response = await fetch("/api/admin/library", { method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: editing.id, tags: tagText.split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean), revision: editing.tagRevision }) });
      const data = await requireApiResponse(response).json();
      if (!response.ok || data.saved !== true) throw new Error(data.error || "无法确认标签保存结果，请重新读取核对。");
      setEditing(null); onDirtyChange(false); refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "标签保存失败，输入已保留。"); }
    finally { working(false); }
  }
  const locked = busy || Boolean(editing);
  return <div className="admin-library">
    <p>所有素材保存在一个目录中，原文件名不变。用标签分类，不创建子文件夹。替换展示位置不会删除旧素材。</p>
    <label className="admin-upload-label">上传照片 / 视频 / GLB / STEP（可多选）<input type="file" multiple accept={MEDIA_UPLOAD_ACCEPT} disabled={locked}
      onChange={event => { void batch(Array.from(event.target.files || [])); event.target.value = ""; }} /></label>
    <p className="fine-print">总容量以后台剩余额度为准。GLB 最多 50 MiB，无需 CAD 转换，需电脑在线校验；STEP / STP 最多 2 GiB，需电脑在线转换为展示模型。新素材需在电脑运行处理程序；未完成的上传可在高级管理中续传。离开页面后，尚未开始上传的本地队列不会保留；已保存的原件仍在素材库中。</p>
    {results.length > 0 && <ul className="admin-upload-results" aria-live="polite">{results.map(row => <li key={row.id}><strong>{row.filename}</strong> — {row.message}</li>)}</ul>}
    <form className="admin-library-filters" onSubmit={event => { event.preventDefault(); setLoading(true); setQuery(value => ({ ...value, q: search, offset: 0 })); }}>
      <label>搜索原文件名<input value={search} maxLength={240} disabled={locked} onChange={event => setSearch(event.target.value)} /></label>
      <label>类型<select value={query.kind} disabled={locked} onChange={event => { setLoading(true); setQuery(value => ({ ...value, kind: event.target.value, offset: 0 })); }}><option value="">全部</option><option value="image">照片</option><option value="video">视频</option><option value="model">3D 模型</option></select></label>
      <label>标签<select value={query.tag} disabled={locked} onChange={event => { setLoading(true); setQuery(value => ({ ...value, tag: event.target.value, offset: 0 })); }}><option value="">全部标签</option>{tags.map(tag => <option key={tag}>{tag}</option>)}</select></label>
      <button type="submit" disabled={locked}>搜索</button><button type="button" disabled={locked || loading} onClick={refresh}>刷新目录</button>
    </form>
    {editing && <form className="admin-tag-editor" onSubmit={saveTags}>
      <strong>{editing.filename}</strong><label>分类标签（逗号分隔，最多 12 个，每个 30 字）<textarea autoFocus value={tagText} disabled={busy} onChange={event => { setTagText(event.target.value); onDirtyChange(true); }} /></label>
      <button type="submit" disabled={busy}>保存标签</button><button type="button" disabled={busy} onClick={() => { setEditing(null); onDirtyChange(false); }}>取消标签编辑</button>
    </form>}
    <p role="status">{message || (loading ? "正在读取素材目录…" : `${items.length} 个已载入的素材`)}</p>
    <div className="admin-library-grid">{items.map(item => <article key={item.id} className="admin-asset">
      {item.processingStatus === "ready" && item.kind !== "model" ?
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/admin/media?assetId=${encodeURIComponent(item.id)}&role=${item.kind === "image" ? "thumbnail" : "poster"}`} alt={item.filename} loading="lazy" /> : <div className="admin-asset-placeholder">{item.kind === "model" ? "3D 模型" : item.kind === "video" ? "视频" : "照片"}</div>}
      <h3>{item.filename}</h3><small>{item.kind === "model" ? "3D 模型" : item.kind === "video" ? "视频" : "照片"} · {new Date(item.createdAt).toLocaleString("zh-CN")} · {(item.size / 1048576).toFixed(1)} MiB · {item.id.slice(0, 8)}</small>
      <p>{assetStatus(item, checkedAt)}</p>
      {item.processingError && <p role="status">{item.processingError}</p>}
      {(item.processingStatus === "failed" || (item.processingStatus === "running" && item.leaseExpiresAt && item.leaseExpiresAt <= checkedAt)) ? <button type="button" disabled={locked} onClick={() => void retryProcessing(item.id)}>重新排队处理</button> : null}
      <p className="admin-tags">{item.tags.length ? item.tags.map(tag => <span key={tag}>{tag}</span>) : "未分类"}</p>
      <button type="button" disabled={locked} onClick={() => { setEditing(item); setTagText(item.tags.join("，")); }}>编辑标签</button>
      {onSelect && <><button type="button" disabled={locked || item.status !== "processing_pending" || Boolean(kinds && !kinds.includes(item.kind))} onClick={() => onSelect(item)}>{item.kind === "model" ? "使用此模型" : "使用此素材"}</button>{item.status !== "processing_pending" ? <p className="fine-print">原件校验完成后才能使用。</p> : kinds && !kinds.includes(item.kind) ? <p className="fine-print">此位置不支持该素材类型。</p> : locked && <p className="fine-print">请先完成当前上传或标签编辑。</p>}</>}
    </article>)}</div>
    {!loading && !items.length && !message && <p>没有匹配的素材；可以上传新文件或清除筛选。</p>}
    {next !== null && <button type="button" disabled={locked || loading} onClick={() => { setLoading(true); setQuery(value => ({ ...value, offset: next })); }}>载入更多</button>}
  </div>;
}
