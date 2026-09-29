"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminEditorContext } from "./admin-editor-context";
import { AdminLibrary } from "./admin-library";
import { AdminPublish } from "./admin-publish";
import { mediaSlots, validateUpload } from "../lib/media.ts";
import { portfolioSections } from "../lib/portfolio.ts";
import { saveDraft } from "../lib/placement-client.ts";
import { uploadFile } from "../lib/upload-client.ts";
import type { readEditorPage } from "../lib/editor-page.ts";
import type { readPageLayouts } from "../lib/layout-store.ts";
import { AdminLayoutEditor } from "./admin-layout-editor";

type Page = Awaited<ReturnType<typeof readEditorPage>>;
export function AdminEditor({ children, path, states, publishSlots, enabled, layoutState }: {
  children: ReactNode; path: string; states: Page["states"]; publishSlots: Page["publishSlots"]; enabled: boolean; layoutState?: Awaited<ReturnType<typeof readPageLayouts>>;
}) {
  const router = useRouter();
  const [refreshing, refresh] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const abort = useRef<AbortController | null>(null);
  const running = useRef(false);
  const [editing, setEditing] = useState(true);
  const [panel, setPanel] = useState<"slot" | "library" | "publish" | null>(null);
  const [slotId, setSlotId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState<string | null>(null);
  const [assetId, setAssetId] = useState("");
  const [filename, setFilename] = useState("");
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const uploadId = useRef("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [libraryDirty, setLibraryDirty] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const layoutActions = useRef<{ save: () => Promise<boolean>; discard: () => void }>(null);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const [savingBeforeLeave, setSavingBeforeLeave] = useState(false);
  const [message, setMessage] = useState("");
  const slot = mediaSlots.find(slot => slot.id === slotId);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || libraryDirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, libraryDirty, busy]);
  function working(value: boolean) { running.current = value; setBusy(value); }
  function open(value: "slot" | "library" | "publish") { setPanel(value); dialog.current?.showModal(); }
  function close() {
    if (running.current || ((dirty || libraryDirty) && !window.confirm("放弃尚未保存的输入？已上传的原件仍保留在素材库。"))) return;
    abort.current?.abort(); dialog.current?.close(); setPanel(null); setDirty(false); setLibraryDirty(false); setSlotId("");
  }
  async function selectSlot(id: string) {
    setSlotId(id); setLoaded(false); setAssetId(""); setFilename(""); setAlt(""); setCaption(""); setFile(null); setDirty(false); setMessage("正在读取此位置…"); open("slot");
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    try {
      const response = await fetch(`/api/admin/placements?slotId=${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "此位置读取失败，请关闭后重试。");
      if (controller.signal.aborted) return;
      const placement = data.placement ?? data.published;
      setRevision(data.revision); setAssetId(placement?.assetId || ""); setAlt(placement?.alt || ""); setCaption(placement?.caption || "");
      setLoaded(true); setMessage(states[id]?.message || "请选择照片或视频。");
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "读取失败，请重试。"); }
  }
  async function uploadSelected() {
    if (!file || !slot || running.current) return;
    working(true); abort.current = new AbortController();
    try {
      const declaration = validateUpload({ filename: file.name, mimeType: file.type, size: file.size });
      if (!slot.kinds.includes(declaration.kind)) throw new Error("此位置只接受照片，请选择图片。");
      const result = await uploadFile(file, uploadId.current, { signal: abort.current.signal,
        onProgress: bytes => setMessage(`正在上传 ${file.name}：${Math.round(bytes / file.size * 100)}%`) });
      if (result.status !== "processing_pending") throw new Error("原件保存尚未确认，请到高级管理核对，勿重复上传。");
      setAssetId(uploadId.current); setFilename(file.name); setFile(null); setDirty(true);
      setMessage("原件已保存，等待电脑处理。填写说明后点击“保存到这个位置”。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "上传失败，请核对素材记录。可到高级管理续传。"); }
    finally { working(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!loaded || !assetId || file || running.current) return;
    working(true);
    try {
      await saveDraft({ slotId, assetId, alt, caption }, revision);
      setDirty(false); dialog.current?.close(); setPanel(null); setSlotId(""); router.refresh();
      setMessage("该位置草稿已保存；发布前请切换预览核对。等待处理的素材暂不能发布。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败，输入仍保留。"); }
    finally { working(false); }
  }
  const leave = (url: string) => {
    if (layoutDirty) { setLeaveTarget(url); leaveDialog.current?.showModal(); return; }
    router.push(url);
  };
  const navigate = (next: string) => leave(`/admin?path=${encodeURIComponent(next)}`);
  async function finishLeave(saveFirst: boolean) {
    if (!leaveTarget || savingBeforeLeave) return;
    setSavingBeforeLeave(true);
    if (saveFirst && !await layoutActions.current?.save()) {
      leaveDialog.current?.close(); setLeaveTarget(null); setSavingBeforeLeave(false); return;
    }
    if (!saveFirst) layoutActions.current?.discard();
    leaveDialog.current?.close(); router.push(leaveTarget); setLeaveTarget(null); setSavingBeforeLeave(false);
  }
  return <AdminEditorContext.Provider value={{ editing, states, selectSlot }}>
    <div className="admin-editor">
      <header className="admin-toolbar" lang="zh-CN">
        <div><strong>页面编辑</strong><small>点击照片位置即可上传或替换 · 草稿不会自动发布</small></div>
        <label>当前页面<select aria-label="当前编辑页面" value={path} onChange={event => navigate(event.target.value)}><option value="/">首页</option>{portfolioSections.map(section => <option key={section.slug} value={`/work/${section.slug}`}>{section.title}</option>)}</select></label>
        <button type="button" aria-pressed={!editing} onClick={() => setEditing(value => !value)}>{editing ? "预览效果" : "返回编辑"}</button>
        <button type="button" onClick={() => { setSlotId(""); open("library"); }}>素材库</button>
        <button type="button" onClick={() => { refresh(() => router.refresh()); open("publish"); }}>发布…</button>
        <Link href="/admin/design" onClick={event => { event.preventDefault(); leave("/admin/design"); }}>全站设计器</Link>
        <Link href="/admin/advanced" onClick={event => { event.preventDefault(); leave("/admin/advanced"); }}>高级管理</Link>
      </header>
      <p className="admin-editor-notice" lang="zh-CN">{editing ? "编辑模式：选择页面中对应的位置；所有上传原件统一保留在素材库。" : "私有预览：编辑按钮已隐藏。待处理或读取失败的位置仍显示占位，发布不会包含它们。"} 上传受后台总额度限制；新素材需要电脑处理。</p>
      {!panel && message && <p className="admin-editor-notice" role="status">{message}</p>}
      <div className="admin-canvas" onClickCapture={event => {
        if (layoutState && editing) return;
        const link = (event.target as HTMLElement).closest("a");
        if (!link) return;
        const url = new URL(link.href, window.location.href);
        if (url.origin === window.location.origin && mediaSlots.some(slot => slot.path === url.pathname)) {
          event.preventDefault(); event.stopPropagation(); navigate(url.pathname);
        }
      }}>{layoutState ? <AdminLayoutEditor pendingMedia={Object.entries(states).filter(([, state]) => state.status !== "published" && state.status !== "empty").map(([id]) => mediaSlots.find(slot => slot.id === id)?.label || id)} actionsRef={layoutActions} initialLayout={layoutState.layout} initialRevision={layoutState.revision} publishedLayout={layoutState.publishedLayout} publishedRevision={layoutState.publishedRevision} enabled={enabled} editing={editing} onDirtyChange={setLayoutDirty}>{children}</AdminLayoutEditor> : children}</div>
      <dialog ref={leaveDialog} className="admin-dialog" aria-labelledby="layout-leave-title" onCancel={event => { if (savingBeforeLeave) event.preventDefault(); else setLeaveTarget(null); }}>
        <h2 id="layout-leave-title">主页排版尚未保存</h2><p>保存失败时会留在当前页面，保留你的修改。</p>
        <button type="button" disabled={savingBeforeLeave} onClick={() => void finishLeave(true)}>保存并离开</button>{" "}
        <button type="button" disabled={savingBeforeLeave} onClick={() => void finishLeave(false)}>放弃修改并离开</button>{" "}
        <button type="button" disabled={savingBeforeLeave} onClick={() => { leaveDialog.current?.close(); setLeaveTarget(null); }}>取消，继续编辑</button>
      </dialog>
      <dialog ref={dialog} className={`admin-dialog ${panel === "slot" ? "admin-slot-dialog" : ""}`} aria-labelledby="admin-dialog-title" onCancel={event => { event.preventDefault(); close(); }}>
        <header className="admin-dialog-heading"><h2 id="admin-dialog-title">{panel === "slot" ? slot?.label : panel === "library" ? "全部素材" : "确认发布"}</h2><button type="button" disabled={busy} onClick={close}>关闭</button></header>
        {panel === "slot" && <form className="admin-slot-form" onSubmit={save}>
          <p>在这个位置上传新文件，或使用素材库中已保存的原件。</p>
          <label>选择新文件<input type="file" disabled={!loaded || busy} accept={slot?.kinds.includes("video") ? "image/jpeg,image/png,image/webp,video/mp4,video/webm" : "image/jpeg,image/png,image/webp"} onChange={event => { setFile(event.target.files?.[0] || null); uploadId.current = crypto.randomUUID(); setDirty(true); }} /></label>
          <button type="button" disabled={!file || busy} onClick={uploadSelected}>上传选中的文件</button>
          <button type="button" disabled={!loaded || busy} onClick={() => setPanel("library")}>从素材库选择</button>
          <p>当前素材：{filename || (assetId ? `已保存的素材 · ${assetId.slice(0, 8)}` : "尚未选择")}</p>
          <label>图片 / 视频说明（必填）<textarea required maxLength={300} value={alt} disabled={!loaded || busy} onChange={event => { setAlt(event.target.value); setDirty(true); }} /></label>
          <label>图注（可选）<textarea maxLength={2000} value={caption} disabled={!loaded || busy} onChange={event => { setCaption(event.target.value); setDirty(true); }} /></label>
          <p role="status">{message}</p>
          <button type="submit" className="feature-button" disabled={!loaded || !assetId || Boolean(file) || busy || !alt.trim()}>保存到这个位置</button>
          <p className="fine-print">只保存私有草稿，不会自动发布。旧照片 / 视频仍保留在素材库中。</p>
        </form>}
        {panel === "library" && <>
          {slot && <button type="button" disabled={busy} onClick={() => { if (!libraryDirty || window.confirm("放弃未保存的标签？")) { setLibraryDirty(false); setPanel("slot"); } }}>← 返回 {slot.label}</button>}
          <AdminLibrary kinds={slot?.kinds} onBusyChange={working} onDirtyChange={setLibraryDirty} onSelect={slot ? item => {
            setAssetId(item.id); setFilename(item.filename); setFile(null); setDirty(true); setPanel("slot");
            setMessage(item.processingStatus === "ready" ? "已选择素材。核对说明后保存到此位置。" : "原件已保存，等待电脑处理。可以先保存位置，但暂不能发布。");
          } : undefined} />
        </>}
        {panel === "publish" && <><p>只列出本页已完成处理、可预览的草稿。一次确认发布一个位置；不会批量覆盖。</p>{refreshing ? <p role="status">正在核对最新草稿…</p> : <AdminPublish key={JSON.stringify(publishSlots)} slots={publishSlots} enabled={enabled} onBusyChange={working} />}</>}
      </dialog>
    </div>
  </AdminEditorContext.Provider>;
}
