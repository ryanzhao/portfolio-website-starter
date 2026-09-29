"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { LayoutContext } from "./layout-context";
import { layoutFonts, resolveElement, resolveBlock, validatePageLayout, type PageLayout, type ElementLayout, type Viewport } from "../lib/page-layout.ts";
import { clamp, editElement, moveBox, recordEdit, sameLayout, travelHistory, type LayoutHistory, type LayoutSelection } from "../lib/layout-editor-state.ts";
import "../app/admin-layout-controls.css";

type Item = LayoutSelection & { label: string; kind: string; text: string; video: boolean };
type Remote = { layout: PageLayout; revision: string | null; publishedLayout: PageLayout; publishedRevision: string | null };
type Snapshot = { id: string; createdAt: string; layout: PageLayout; previousLayout?: PageLayout; kind?: string };
type Mode = "move" | "resize" | "crop";
const viewportWidth = { desktop: 1440, tablet: 768, mobile: 390 };
const viewportLabel = { desktop: "电脑", tablet: "平板", mobile: "手机" };
const blockLabel: Record<string, string> = { hero: "首屏", bio: "个人介绍", journey: "旅程", "advanced-rockets-engines": "先进火箭与发动机", "chemistry-propellant": "化学与推进剂", electronics: "电子与控制系统", "education-outreach": "教育与科普", teamworks: "团队合作与领导力" };
const fontLabel: Record<string, string> = { arial: "Arial", georgia: "Georgia", times: "Times New Roman", garet: "Garet（本机字体）", system: "系统无衬线", mono: "等宽字体" };

async function layoutRequest(body?: object, suffix = ""): Promise<Remote & { snapshots?: Snapshot[]; nextCursor?: string | null }> {
  const response = await fetch(`/api/admin/layout${suffix}`, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

export function AdminLayoutEditor({ children, initialLayout, initialRevision, publishedLayout: originalPublished, publishedRevision: originalPublishedRevision, enabled, editing, onDirtyChange, actionsRef, pendingMedia = [] }: {
  children: ReactNode; initialLayout: PageLayout; initialRevision: string | null; publishedLayout: PageLayout; publishedRevision: string | null;
  enabled: boolean; editing: boolean; onDirtyChange?: (dirty: boolean) => void; actionsRef?: Ref<{ save: () => Promise<boolean>; discard: () => void }>; pendingMedia?: string[];
}) {
  const [layout, setLayout] = useState(initialLayout);
  const current = useRef(layout);
  const [saved, setSaved] = useState(initialLayout);
  const [revision, setRevision] = useState(initialRevision);
  const [published, setPublished] = useState(originalPublished);
  const [publishedRevision, setPublishedRevision] = useState(originalPublishedRevision);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [selected, setSelected] = useState<LayoutSelection | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<LayoutHistory>({ past: [], future: [] });
  const [mode, setMode] = useState<Mode>("move");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [remote, setRemote] = useState<Remote | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [videoZoomSupported, setVideoZoomSupported] = useState(true);
  const [comparison, setComparison] = useState<Snapshot | null>(null);
  const [snapshotVersion, setSnapshotVersion] = useState<"candidate" | "previous">("candidate");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [overlay, setOverlay] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [guides, setGuides] = useState<{ axis: "x" | "y"; value: number; left: number; top: number; width: number; height: number }[]>([]);
  const canvas = useRef<HTMLDivElement>(null);
  const validationCanvas = useRef<HTMLDivElement>(null);
  const [validating, setValidating] = useState(false);
  const fieldBefore = useRef<PageLayout | null>(null);
  const gesture = useRef<{ before: PageLayout; startX: number; startY: number; mode: Mode; box: { x: number; y: number; width: number; height: number }; block: DOMRect; focusX: number; focusY: number } | null>(null);
  const dirty = !sameLayout(layout, saved);
  const item = items.find(value => value.blockId === selected?.blockId && value.elementId === selected?.elementId);
  const value = selected ? resolveElement(layout, selected.blockId, selected.elementId, viewport) : {};
  const blockValue = selected ? resolveBlock(layout, selected.blockId, viewport) : undefined;

  function update(next: PageLayout, commit = true) {
    const before = current.current;
    if (commit) setHistory(old => recordEdit(old, before, next));
    current.current = next; setLayout(next); setMessage(""); setConfirmPublish(false);
  }
  function finishField() {
    const before = fieldBefore.current, after = current.current;
    if (before) setHistory(old => recordEdit(old, before, after));
    fieldBefore.current = null;
  }
  function patch(patchValue: Partial<ElementLayout>, commit = !fieldBefore.current) {
    if (selected) {
      const next = editElement(current.current, selected, viewport, patchValue);
      if (patchValue.x !== undefined || patchValue.y !== undefined) keepBlockHeight(next, measureBox()?.block.height);
      update(next, commit);
    }
  }
  function keepBlockHeight(next: PageLayout, measuredHeight?: number) {
    if (!selected || measuredHeight === undefined || resolveBlock(next, selected.blockId, viewport).height !== undefined) return;
    const block = next.blocks[selected.blockId];
    const target = viewport === "desktop" ? block : (block.overrides ??= {})[viewport] ??= { elements: {} };
    target.height = clamp(Math.ceil(measuredHeight), 120, 6000);
  }
  function findElement(selection: LayoutSelection | null = selected) {
    if (!selection) return null;
    return Array.from(canvas.current?.querySelectorAll<HTMLElement>("[data-layout-element]") ?? []).find(element =>
      element.dataset.layoutElement === selection.elementId && element.closest<HTMLElement>("[data-layout-block]")?.dataset.layoutBlock === selection.blockId) ?? null;
  }
  function measureBox() {
    const element = findElement(); const block = element?.closest<HTMLElement>("[data-layout-block]");
    if (!element || !block) return null;
    const e = element.getBoundingClientRect(), b = block.getBoundingClientRect();
    if (!e.width || !e.height || !b.width || !b.height) return null;
    const width = clamp(e.width / b.width * 100, 0.1, 100), height = clamp(e.height / b.height * 100, 0.1, 100);
    return { block: b, box: { x: clamp((e.left - b.left) / b.width * 100, 0, 100 - width), y: clamp((e.top - b.top) / b.height * 100, 0, 100 - height), width, height } };
  }

  useEffect(() => { onDirtyChange?.(dirty || busy); }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const all = Array.from(canvas.current?.querySelectorAll<HTMLElement>("[data-layout-element]") ?? []).map(element => ({
        blockId: element.closest<HTMLElement>("[data-layout-block]")?.dataset.layoutBlock || "",
        elementId: element.dataset.layoutElement!, label: element.dataset.layoutLabel || element.dataset.layoutElement!,
        kind: element.dataset.layoutKind || "text", text: element.textContent || "", video: Boolean(element.querySelector("video")),
      })).filter(element => element.blockId);
      setItems(all);
      setVideoZoomSupported(CSS.supports("object-view-box", "inset(10%)"));
    });
    return () => cancelAnimationFrame(frame);
  }, [layout, viewport, children]);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
        const element = findElement(); const parent = canvas.current;
        if (!editing || !element || !parent || !element.getBoundingClientRect().width) { setOverlay(null); return; }
        const e = element.getBoundingClientRect(), c = parent.getBoundingClientRect();
        setOverlay({ left: e.left - c.left, top: e.top - c.top, width: e.width, height: e.height });
      });
    };
    const observer = new ResizeObserver(measure);
    if (canvas.current) observer.observe(canvas.current);
    const element = findElement(); if (element) observer.observe(element);
    measure(); window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
    // Selection and layout are the complete inputs to DOM measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, layout, viewport, editing]);

  function undo(direction: "undo" | "redo") {
    finishField(); const result = travelHistory(history, current.current, direction);
    setHistory(result.history); current.current = result.layout; setLayout(result.layout); setConfirmPublish(false);
  }
  function beginGesture(event: ReactPointerEvent<HTMLButtonElement>, nextMode: Mode) {
    const measured = measureBox(); if (!selected || !measured || busy) return;
    event.preventDefault(); event.stopPropagation(); finishField();
    setMode(nextMode);
    event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus();
    gesture.current = { before: current.current, startX: event.clientX, startY: event.clientY, mode: nextMode, ...measured, focusX: value.focusX ?? 50, focusY: value.focusY ?? 50 };
  }
  function moveGesture(event: ReactPointerEvent<HTMLButtonElement>) {
    const g = gesture.current; if (!g || !selected) return;
    const dx = (event.clientX - g.startX) / g.block.width * 100, dy = (event.clientY - g.startY) / g.block.height * 100;
    let change: Partial<ElementLayout>;
    if (g.mode === "crop") change = { focusX: clamp(g.focusX - dx * 100 / g.box.width, 0, 100), focusY: clamp(g.focusY - dy * 100 / g.box.height, 0, 100) };
    else if (g.mode === "resize") change = { ...g.box, width: clamp(g.box.width + dx, 0.1, 100 - g.box.x), height: clamp(g.box.height + dy, 0.1, 100 - g.box.y) };
    else {
      const moved = moveBox(g.box, dx, dy, !event.altKey); change = { ...g.box, x: moved.x, y: moved.y };
      const c = canvas.current!.getBoundingClientRect();
      setGuides(moved.guides.map(guide => ({ ...guide, left: g.block.left - c.left, top: g.block.top - c.top, width: g.block.width, height: g.block.height })));
    }
    const next = editElement(g.before, selected, viewport, change);
    if (g.mode !== "crop") keepBlockHeight(next, g.block.height);
    update(next, false);
  }
  function finishGesture(cancel = false) {
    const g = gesture.current; if (!g) return;
    if (cancel) { current.current = g.before; setLayout(g.before); }
    else setHistory(old => recordEdit(old, g.before, current.current));
    gesture.current = null; setGuides([]);
  }
  function keyboard(event: React.KeyboardEvent) {
    if (event.key === "Escape") { if (gesture.current) finishGesture(true); else { setMode("move"); setSelected(null); } return; }
    if ((event.target as HTMLElement).matches("input,textarea,select,[contenteditable=true]")) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(event.shiftKey ? "redo" : "undo"); return; }
    if (!selected || busy || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const measured = measureBox(); if (!measured) return;
    event.preventDefault(); const speed = event.shiftKey ? 10 : 1;
    const dx = (event.key === "ArrowLeft" ? -speed : event.key === "ArrowRight" ? speed : 0) / measured.block.width * 100;
    const dy = (event.key === "ArrowUp" ? -speed : event.key === "ArrowDown" ? speed : 0) / measured.block.height * 100;
    if (mode === "crop") patch({ focusX: clamp((value.focusX ?? 50) + dx, 0, 100), focusY: clamp((value.focusY ?? 50) + dy, 0, 100) });
    else if (mode === "resize") patch({ ...measured.box, width: clamp(measured.box.width + dx, 0.1, 100 - measured.box.x), height: clamp(measured.box.height + dy, 0.1, 100 - measured.box.y) });
    else { const moved = moveBox(measured.box, dx, dy, false); patch({ ...measured.box, x: moved.x, y: moved.y }); }
  }
  function reset(whole: boolean) {
    if (!selected || !window.confirm(whole ? `恢复 ${selected.blockId} 整个区块默认布局？包括三个视图、新增文本和文字修改。可撤销。` : `清除 ${selected.blockId} 的${viewportLabel[viewport]}设置？${viewport === "desktop" ? "桌面文字与样式修改也会清除，其他视图覆盖保留。" : "文字和样式恢复继承，位置恢复默认。"}可撤销。`)) return;
    const next = structuredClone(current.current), block = next.blocks[selected.blockId]; if (!block) return;
    if (whole) delete next.blocks[selected.blockId];
    else if (viewport === "desktop") next.blocks[selected.blockId] = { elements: {}, ...(block.overrides ? { overrides: block.overrides } : {}) };
    else if (block.overrides) delete block.overrides[viewport];
    update(next);
  }
  function changeBlockHeight(height: number) {
    if (!selected) return; const next = structuredClone(current.current);
    const block = next.blocks[selected.blockId] ??= { elements: {} };
    const target = viewport === "desktop" ? block : (block.overrides ??= {})[viewport] ??= { elements: {} };
    target.height = clamp(height, 120, 6000); update(next, !fieldBefore.current);
  }
  function addText() {
    if (!selected) return;
    const block = current.current.blocks[selected.blockId];
    const added = new Set([Object.keys(block?.elements || {}), Object.keys(block?.overrides?.tablet?.elements || {}), Object.keys(block?.overrides?.mobile?.elements || {})].flat().filter(id => id.startsWith("text-")));
    if (added.size >= 20) { setMessage("此区块最多新增 20 个文本块。"); return; }
    const selection = { blockId: selected.blockId, elementId: `text-${crypto.randomUUID()}` };
    // Custom text content belongs to the block; geometry is specific to this view.
    let next = editElement(current.current, selection, "desktop", { text: "New text" });
    next = editElement(next, selection, viewport, { x: 5, y: 5, width: 40, fontSize: 24 });
    update(next); setSelected(selection); setMode("move");
  }
  function removeText() {
    if (!selected) return; const next = structuredClone(current.current); const block = next.blocks[selected.blockId]; if (!block) return;
    delete block.elements[selected.elementId];
    if (block.overrides?.tablet) delete block.overrides.tablet.elements[selected.elementId];
    if (block.overrides?.mobile) delete block.overrides.mobile.elements[selected.elementId];
    update(next); setSelected(null);
  }
  async function checkOverflow() {
    flushSync(() => setValidating(true));
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
    for (const element of validationCanvas.current?.querySelectorAll<HTMLElement>("[data-layout-element]") ?? []) {
      const block = element.closest<HTMLElement>("[data-layout-block]"); if (!block || !element.getBoundingClientRect().width) continue;
      const checkedView = element.closest<HTMLElement>("[data-validation-view]")!.dataset.validationView as Viewport;
      const e = element.getBoundingClientRect(), b = block.getBoundingClientRect();
      const configured = resolveElement(current.current, block.dataset.layoutBlock!, element.dataset.layoutElement!, checkedView);
      if (!Object.keys(configured).length || configured.hidden) continue;
      if (e.top < b.top - 3 || e.bottom > b.bottom + 3 || e.right > b.right + 3 || e.left < b.left - 3 || (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 3)) {
        setViewport(checkedView); setSelected({ blockId: block.dataset.layoutBlock!, elementId: element.dataset.layoutElement! });
        throw new Error(`${viewportLabel[checkedView]}视图：${element.dataset.layoutLabel || element.dataset.layoutElement} 超出区块，请增加区块高度、调整位置或文本宽度后保存。`);
      }
    }
    } finally { setValidating(false); }
  }
  async function save() {
    if (busy) return false; finishField(); setBusy(true); setMessage("正在核对版本并保存…");
    try {
      validatePageLayout(current.current); await checkOverflow();
      const latest = await layoutRequest();
      if (latest.revision !== revision) { setRemote(latest); throw new Error("远程草稿已变化。请比较后选择加载远程或重新应用本地修改。"); }
      const submitted = current.current;
      await layoutRequest({ action: "save", layout: submitted, revision });
      const confirmed = await layoutRequest();
      if (!sameLayout(confirmed.layout, submitted)) { setRemote(confirmed); throw new Error("保存读回与当前内容不一致，请核对远程版本。"); }
      setRevision(confirmed.revision); setSaved(confirmed.layout); setPublished(confirmed.publishedLayout); setPublishedRevision(confirmed.publishedRevision);
      setFailed(false); setMessage("草稿已保存并读回验证；尚未发布。"); return true;
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "保存失败，输入仍保留。重试会先核对远程版本。"); return false; }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!confirmPublish || busy || dirty) return; setBusy(true); setMessage("正在备份并发布布局…");
    try {
      await layoutRequest({ action: "publish", revision, publishedRevision, confirmed: true });
      const confirmed = await layoutRequest();
      if (!sameLayout(confirmed.publishedLayout, saved)) throw new Error("发布结果尚未确认，请重新读取公开布局后再操作。");
      setRevision(confirmed.revision); setPublished(confirmed.publishedLayout); setPublishedRevision(confirmed.publishedRevision); setConfirmPublish(false); setShowPublish(false); setMessage("布局已发布并读回验证。媒体发布状态未改变。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "发布失败";
      try { const latest = await layoutRequest(); if (sameLayout(latest.layout, saved)) setRevision(latest.revision); else setRemote(latest); setPublished(latest.publishedLayout); setPublishedRevision(latest.publishedRevision); setMessage(`${message}；已重新读取公开版本，请比较后重新确认。`); }
      catch { setMessage(`${message}；远程状态暂不可读，请稍后核对，勿盲目重复发布。`); }
      setConfirmPublish(false);
    } finally { setBusy(false); }
  }
  async function loadHistory(cursor?: string) {
    setBusy(true); try { const result = await layoutRequest(undefined, `?history=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`); setSnapshots(old => cursor ? [...(old || []), ...(result.snapshots || [])] : result.snapshots || []); setHistoryCursor(result.nextCursor || null); }
    catch (error) { setMessage(error instanceof Error ? error.message : "历史读取失败"); } finally { setBusy(false); }
  }
  async function restore() {
    if (!comparison || busy || !window.confirm("将比较中的历史版本恢复为草稿？服务端会先备份当前已保存草稿；当前未保存调整将被替换（本次仍可撤销）。不会修改公开页面。")) return;
    setBusy(true);
    try {
      await layoutRequest({ action: "restore", snapshotId: comparison.id, version: snapshotVersion, revision, confirmed: true });
      const confirmed = await layoutRequest(); update(confirmed.layout); setSaved(confirmed.layout); setRevision(confirmed.revision); setComparison(null); setMessage("历史版本已恢复为草稿并读回；公开版本未改变。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "恢复失败，当前输入保留。"); }
    finally { setBusy(false); }
  }

  useImperativeHandle(actionsRef, () => ({ save, discard: () => { update(saved); setFailed(false); } }));

  const numberField = (key: keyof ElementLayout, label: string, min: number, max: number, step = 1, fallback = min) => <label key={key}>{label}<input aria-label={label} type="number" min={min} max={max} step={step} disabled={key === "zoom" && !videoZoomSupported && Boolean(item?.video)} value={typeof value[key] === "number" ? value[key] as number : ""} placeholder={`${fallback}`} onChange={event => {
    if (event.target.value === "" || !Number.isFinite(event.target.valueAsNumber)) return;
    let number = clamp(event.target.valueAsNumber, min, max);
    const measured = measureBox();
    if (measured && ["x", "y", "width", "height"].includes(key)) {
      const box = { ...measured.box, ...Object.fromEntries(Object.entries(value).filter(([field]) => ["x", "y", "width", "height"].includes(field))) };
      if (key === "x") number = Math.min(number, 100 - box.width);
      if (key === "y") number = Math.min(number, 100 - box.height);
      if (key === "width") number = Math.min(number, 100 - box.x);
      if (key === "height") number = Math.min(number, 100 - box.y);
      patch({ ...box, [key]: number });
    } else patch({ [key]: number });
  }} /></label>;
  const compare = (left: PageLayout, right: PageLayout) => {
    const labels: Record<string,string> = {text:"文字",hidden:"隐藏",font:"字体",fontSize:"字号",fontWeight:"字重",color:"颜色",lineHeight:"行距",letterSpacing:"字距",align:"对齐",x:"水平位置",y:"垂直位置",width:"框宽度",height:"高度",fit:"画面适配",zoom:"取景缩放",focusX:"水平焦点",focusY:"垂直焦点",borderWidth:"边框粗细",borderColor:"边框颜色",radius:"圆角",z:"区块内层级"};
    const rows: {name:string;before:string;after:string}[] = [];
    const describe = (key:string,entry:unknown) => entry === undefined ? "默认 / 继承" : key === "font" ? fontLabel[String(entry)] : key === "hidden" ? entry ? "隐藏" : "显示" : key === "fit" ? entry === "cover" ? "填满裁剪" : "完整显示" : String(entry);
    for (const blockId of new Set([...Object.keys(left.blocks),...Object.keys(right.blocks)])) {
      for (const view of ["desktop","tablet","mobile"] as const) {
        const a = view === "desktop" ? left.blocks[blockId] : left.blocks[blockId]?.overrides?.[view];
        const b = view === "desktop" ? right.blocks[blockId] : right.blocks[blockId]?.overrides?.[view];
        if(a?.height !== b?.height) rows.push({name:`${blockId} · ${viewportLabel[view]} · 区块高度`,before:describe("height",a?.height),after:describe("height",b?.height)});
        for(const id of new Set([...Object.keys(a?.elements || {}),...Object.keys(b?.elements || {})])) {
          const av=a?.elements[id] || {},bv=b?.elements[id] || {};
          for(const key of new Set([...Object.keys(av),...Object.keys(bv)])) {
            const field=key as keyof ElementLayout;if(av[field]===bv[field])continue;
            rows.push({name:`${items.find(item=>item.blockId===blockId&&item.elementId===id)?.label || (id.startsWith("text-")?"新增文字":id)} · ${viewportLabel[view]} · ${labels[key] || key}`,before:describe(key,av[field]),after:describe(key,bv[field])});
          }
        }
      }
    }
    return <div className="layout-comparison">{rows.length ? <table><thead><tr><th>修改项</th><th>当前内容</th><th>比较版本</th></tr></thead><tbody>{rows.map((row,index)=><tr key={index}><th>{row.name}</th><td>{row.before}</td><td>{row.after}</td></tr>)}</tbody></table> : <p>两个版本的布局相同。</p>}</div>;
  };
  return <LayoutContext.Provider value={{ layout, viewport: editing ? viewport : undefined, editing, selected, onSelect: setSelected }}>
    {validating && <div ref={validationCanvas} aria-hidden="true" inert style={{position:"fixed",left:-100000,top:0,visibility:"hidden",pointerEvents:"none"}}>
      {(["desktop","tablet","mobile"] as const).map(view => <div key={view} className="layout-canvas" data-validation-view={view} style={{width:viewportWidth[view],maxWidth:"none"}}>
        <LayoutContext.Provider value={{layout,viewport:view,editing:false,selected:null}}>{children}</LayoutContext.Provider>
      </div>)}
    </div>}
    <div className={`layout-editor ${editing ? "is-editing" : ""}`} onKeyDown={keyboard}>
      {editing && <section className="layout-toolbar" aria-label="主页排版工具" lang="zh-CN">
        <strong>区块排版</strong><label>视图<select aria-label="视图" value={viewport} disabled={busy} onChange={event => { finishGesture(true); setViewport(event.target.value as Viewport); }}>{Object.entries(viewportLabel).map(([key, label]) => <option key={key} value={key}>{label} · {viewportWidth[key as Viewport]}px</option>)}</select></label>
        <button type="button" disabled={!history.past.length || busy} onClick={() => undo("undo")}>撤销</button><button type="button" disabled={!history.future.length || busy} onClick={() => undo("redo")}>重做</button>
        <button type="button" disabled={busy || (!dirty && !failed)} onClick={() => void save()}>{busy ? "处理中…" : failed ? "核对并重试保存" : "保存草稿"}</button>
        <button type="button" disabled={busy} onClick={() => { setShowPublish(!showPublish); setConfirmPublish(false); }}>发布布局…</button>
        <button type="button" disabled={busy} onClick={() => void loadHistory()}>布局历史</button>
        <span role="status">{busy ? "处理中" : failed ? "保存失败（输入保留）" : dirty ? "未保存" : "已保存"}</span>
      </section>}
      {message && <p className="layout-message" role="status" lang="zh-CN">{message}</p>}
      {editing && remote && <section className="layout-notice" lang="zh-CN"><h2>版本冲突：先比较</h2>{compare(layout, remote.layout)}<button type="button" onClick={() => { update(remote.layout); setSaved(remote.layout); setRevision(remote.revision); setRemote(null); setFailed(false); }}>加载远程草稿（本地可撤销）</button><button type="button" onClick={() => { if (window.confirm("以远程最新修订为基础重新应用当前所有本地修改？仍需再次点击保存，不会自动合并。")) { setRevision(remote.revision); setSaved(remote.layout); setRemote(null); setMessage("已重新应用本地修改，请核对并保存。"); } }}>明确重新应用本地修改</button></section>}
      {editing && showPublish && <section className="layout-notice" lang="zh-CN"><h2>仅发布主页文字与排版</h2><p>以下比较为当前布局与已发布布局。媒体须在原有媒体发布面板单独确认；此操作不会发布任何待发布媒体。</p>{pendingMedia.length > 0 && <p>本次不会发布的媒体：{pendingMedia.join("、")}。</p>}{compare(layout, published)}<a href="/admin/preview?path=/&layoutPublication=1" target="_blank" rel="noopener noreferrer">打开已保存布局 + 已发布媒体的实际发布预览</a><p>{dirty ? "请先保存草稿，预览和发布只采用服务端已保存版本。" : "请先打开实际发布预览核对全部区块。"}</p><label><input type="checkbox" checked={confirmPublish} disabled={busy || dirty || !enabled} onChange={event => setConfirmPublish(event.target.checked)} />我已核对实际发布预览及布局变化，确认发布布局</label><button type="button" disabled={!confirmPublish || busy || dirty || !enabled || sameLayout(saved, published)} onClick={() => void publish()}>确认发布布局</button>{!enabled && <p>当前环境尚未启用发布。</p>}</section>}
      {editing && snapshots && <section className="layout-notice" lang="zh-CN"><h2>布局历史（非全站备份）</h2><button type="button" onClick={() => { setSnapshots(null); setComparison(null); }}>关闭历史</button>{!snapshots.length && <p>暂无布局快照。</p>}{snapshots.map(snapshot => <button key={snapshot.id} type="button" onClick={() => { setComparison(snapshot); setSnapshotVersion("candidate"); }}>比较 {snapshot.kind === "publish" ? "发布前快照" : "草稿保留快照"} {snapshot.createdAt || snapshot.id}</button>)}{historyCursor && <button type="button" disabled={busy} onClick={() => void loadHistory(historyCursor)}>更多历史</button>}{comparison && <><label>恢复来源<select aria-label="恢复来源" value={snapshotVersion} onChange={event => setSnapshotVersion(event.target.value as "candidate" | "previous")}><option value="candidate">快照中的草稿</option>{comparison.previousLayout && <option value="previous">当时的公开版本</option>}</select></label>{compare(layout, snapshotVersion === "previous" ? comparison.previousLayout! : comparison.layout)}<button type="button" disabled={busy} onClick={() => void restore()}>确认恢复为草稿…</button></>}</section>}
      <div className="layout-workspace">
        <div className="layout-canvas-scroll"><div ref={canvas} className="layout-canvas" data-layout-viewport={viewport} style={editing ? { width: viewportWidth[viewport] } : undefined} onClickCapture={event => {
          if (!editing) return;
          const target = event.target as HTMLElement; if (target.closest(".layout-selection, .admin-slot-button")) return;
          const element = target.closest<HTMLElement>("[data-layout-element]"); const block = element?.closest<HTMLElement>("[data-layout-block]");
          if (element && block) { event.preventDefault(); event.stopPropagation(); finishField(); setSelected({ blockId: block.dataset.layoutBlock!, elementId: element.dataset.layoutElement! }); }
          else { setSelected(null); if (target.closest("a,video,button")) { event.preventDefault(); event.stopPropagation(); } }
        }}>
          {children}
          {editing && overlay && selected && <div className="layout-selection" style={overlay} aria-label="选中元素操作">
            <button type="button" className="layout-drag-handle" aria-label={mode === "crop" ? "拖动调整取景焦点" : "拖动移动元素；方向键微调"} onPointerDown={event => beginGesture(event, mode === "crop" ? "crop" : "move")} onPointerMove={moveGesture} onPointerUp={() => finishGesture()} onPointerCancel={() => finishGesture(true)}>{mode === "crop" ? "取景" : "移动"}</button>
            {mode !== "crop" && <button type="button" className="layout-resize-handle" aria-label="拖动调整尺寸；方向键微调" onFocus={() => setMode("resize")} onPointerDown={event => beginGesture(event, "resize")} onPointerMove={moveGesture} onPointerUp={() => finishGesture()} onPointerCancel={() => finishGesture(true)}>↘</button>}
          </div>}
          {editing && guides.map((guide, index) => <div key={index} className="layout-guide" style={guide.axis === "x" ? { left: guide.left + guide.width * guide.value / 100, top: guide.top, height: guide.height, width: 1 } : { left: guide.left, top: guide.top + guide.height * guide.value / 100, width: guide.width, height: 1 }} />)}
        </div></div>
        {editing && <aside className="layout-properties" aria-label="元素属性" lang="zh-CN">
          <label>区块内元素（含隐藏）<select aria-label="区块内元素（含隐藏）" value={selected ? `${selected.blockId}/${selected.elementId}` : ""} onChange={event => { const found = items.find(candidate => `${candidate.blockId}/${candidate.elementId}` === event.target.value); setSelected(found ? { blockId: found.blockId, elementId: found.elementId } : null); setMode("move"); }}><option value="">请选择元素</option>{items.map(candidate => <option key={`${candidate.blockId}/${candidate.elementId}`} value={`${candidate.blockId}/${candidate.elementId}`}>{blockLabel[candidate.blockId] || "区块"} · {candidate.label}{resolveElement(layout, candidate.blockId, candidate.elementId, viewport).hidden ? "（隐藏）" : ""}</option>)}</select></label>
          {!selected ? <p>点击区块内文字或媒体框，或从列表选择。方向键微移，Shift 加速，Escape 取消拖动；Alt 拖动关闭吸附。</p> : <fieldset disabled={busy} onFocusCapture={event => { if ((event.target as HTMLElement).matches("input,textarea")) fieldBefore.current = current.current; }} onBlurCapture={event => { if ((event.target as HTMLElement).matches("input,textarea")) finishField(); }}>
            <legend>{blockLabel[selected.blockId] || "区块"} · {item?.label || "选中元素"}</legend>
            <div className="layout-mode"><button type="button" aria-pressed={mode === "move"} onClick={() => setMode("move")}>移动框</button><button type="button" aria-pressed={mode === "resize"} onClick={() => setMode("resize")}>调整尺寸</button>{item?.kind === "media" && <button type="button" aria-pressed={mode === "crop"} onClick={() => setMode(mode === "crop" ? "move" : "crop")}>{mode === "crop" ? "退出取景" : "编辑取景"}</button>}</div>
            {item?.kind !== "media" && <><label htmlFor="layout-text-content">纯文本<textarea id="layout-text-content" aria-label="纯文本" maxLength={2000} value={value.text ?? item?.text ?? ""} onChange={event => patch({ text: event.target.value })} /></label><label>字体<select aria-label="字体" value={value.font ?? ""} onChange={event => { if (event.target.value) patch({ font: event.target.value as ElementLayout["font"] }); }}><option value="">原有字体</option>{Object.keys(layoutFonts).map(font => <option value={font} key={font}>{fontLabel[font]}</option>)}</select></label>{value.font === "garet" && <small>Garet 仅在访问者本机已安装时使用；未安装时显示系统无衬线字体。</small>}<div className="layout-fields">{numberField("fontSize", "字号 px", 12, 160, 1, 24)}<label>字重<select aria-label="字重" value={value.fontWeight ?? 400} onChange={event => patch({ fontWeight: Number(event.target.value) as ElementLayout["fontWeight"] })}>{[400, 500, 600, 700].map(weight => <option key={weight}>{weight}</option>)}</select></label>{numberField("lineHeight", "行距", 1, 2.5, 0.05, 1.3)}{numberField("letterSpacing", "字距 em", -0.05, 0.2, 0.01, 0)}<label>文字颜色<input aria-label="文字颜色" type="color" value={value.color || "#ffffff"} onChange={event => patch({ color: event.target.value })} /></label><label>对齐<select aria-label="对齐" value={value.align ?? "left"} onChange={event => patch({ align: event.target.value as ElementLayout["align"] })}><option value="left">左</option><option value="center">中</option><option value="right">右</option></select></label></div></>}
            <div className="layout-fields">{numberField("x", "水平位置 %", 0, 99.9, 0.1, 0)}{numberField("y", "垂直位置 %", 0, 99.9, 0.1, 0)}{numberField("width", "框宽度 %", 0.1, 100, 0.1, 50)}{numberField("height", "框高度 %", 0.1, 100, 0.1, 20)}{numberField("z", "区块内层级", 0, 50, 1, 0)}</div>
            {item?.kind === "media" && <><div className="layout-fields">{numberField("borderWidth", "边框 px", 0, 20, 1, 0)}<label>边框颜色<input aria-label="边框颜色" type="color" value={value.borderColor || "#ffffff"} onChange={event => patch({ borderColor: event.target.value })} /></label>{numberField("radius", "圆角 px", 0, 100, 1, 0)}</div><label>画面适配<select aria-label="画面适配" value={value.fit ?? "contain"} onChange={event => patch({ fit: event.target.value as ElementLayout["fit"] })}><option value="contain">完整显示（可能留边）</option><option value="cover">填满裁剪</option></select></label>{mode === "crop" && !videoZoomSupported && <p>此浏览器不支持视频画面缩放；视频仍可调整焦点、适配方式及框尺寸。图片缩放可用。</p>}{mode === "crop" && <div className="layout-fields">{numberField("zoom", "取景缩放", 1, 4, 0.1, 1)}{numberField("focusX", "水平焦点 %", 0, 100, 1, 50)}{numberField("focusY", "垂直焦点 %", 0, 100, 1, 50)}</div>}</>}
            <label><input type="checkbox" checked={value.hidden ?? false} onChange={event => patch({ hidden: event.target.checked })} />隐藏此元素（保留内容）</label>
            <button type="button" onClick={addText}>在此区块添加文本</button>{selected.elementId.startsWith("text-") && <button type="button" onClick={removeText}>删除新增文本（可撤销）</button>}
            <label>区块最小高度 px<input aria-label="区块最小高度 px" type="number" min={120} max={6000} step={10} value={blockValue?.height ?? ""} placeholder="原始高度" onChange={event => { if (event.target.value && Number.isFinite(event.target.valueAsNumber)) changeBlockHeight(event.target.valueAsNumber); }} /></label>
            <button type="button" onClick={() => changeBlockHeight(Math.min(6000, (blockValue?.height || measureBox()?.block.height || 600) + 100))}>区块增加 100px</button><button type="button" onClick={() => reset(false)}>重置当前视图…</button><button type="button" onClick={() => reset(true)}>恢复区块默认…</button>
            <p>桌面为基础；平板和手机文字样式可继承，位置仅在当前视图修改后启用。文本超出区块时需增加高度或调整位置。</p>
          </fieldset>}
        </aside>}
      </div>
    </div>
  </LayoutContext.Provider>;
}
