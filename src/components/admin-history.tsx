"use client";

import { useRef, useState } from "react";
import { mediaSlots } from "@/lib/media";
import type { readPlacementHistory } from "@/lib/placement-recovery";

type History = Awaited<ReturnType<typeof readPlacementHistory>>;
type Review = { item: History["items"][number]; side: "candidate" | "previous"; current: History["current"] };

export function AdminHistory() {
  const [slotId, setSlotId] = useState("");
  const [items, setItems] = useState<History["items"]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("选择展示位置后读取历史；历史快照不代表那次发布成功。");
  const running = useRef(false);
  const slot = mediaSlots.find(item => item.id === slotId);

  async function read(compare = false, next?: string) {
    if (!slotId || running.current) return;
    running.current = true; setBusy(true); setReview(null); setConfirmed(false);
    try {
      const [id, side] = choice.split(":");
      const query = new URLSearchParams({ slotId });
      if (compare) query.set("snapshotId", id);
      else if (next) query.set("cursor", next);
      const response = await fetch(`/api/admin/history?${query}`, { credentials: "same-origin", cache: "no-store" });
      const data: History & { error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error || "无法读取历史。");
      if (!Array.isArray(data.items)) throw new Error("历史记录格式无效。");
      if (compare) {
        const item = data.items.find(item => item.id === id);
        if (!item || (side !== "candidate" && side !== "previous") || !item[side]) throw new Error("所选版本不可恢复。");
        setReview({ item, side, current: data.current });
        setMessage("请核对下方差异。恢复前会保留当前草稿；不会修改线上内容。");
      } else {
        setItems(data.items); setCursor(data.nextCursor); setChoice("");
        setMessage(data.items.length ? "已读取本页历史。请选择版本并查看差异。" : "本页没有可访问的历史；若有下一页可继续读取。损坏快照不会提供恢复。");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "历史读取失败。"); }
    finally { running.current = false; setBusy(false); }
  }

  async function restore() {
    if (!review || !confirmed || running.current) return;
    running.current = true; setBusy(true);
    try {
      const response = await fetch("/api/admin/history", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ slotId, snapshotId: review.item.id,
          version: review.item.version, side: review.side, revision: review.current.revision, confirmed: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "恢复未确认，请重新读取草稿核对。");
      if (data.saved !== true || data.published !== false) throw new Error("恢复结果未确认，请核对草稿，勿盲目重试。");
      setMessage(`已恢复为私有草稿，尚未发布。操作编号：${data.operationId}。请打开整页预览核对。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "恢复结果未知，请核对草稿，勿盲目重试。"); }
    finally { setReview(null); setConfirmed(false); running.current = false; setBusy(false); }
  }
  const target = review?.item[review.side]?.placement;
  return <section className="notice" aria-labelledby="history-heading">
    <h2 id="history-heading">历史恢复 · 私有草稿</h2>
    <p>恢复素材引用与说明，不恢复整个网站。快照可能来自发布尝试或草稿留存，不证明曾公开发布。</p>
    <label htmlFor="history-slot">历史展示位置</label>
    <select id="history-slot" aria-describedby="history-slot-label" className="block w-full border p-2 my-2" value={slotId} disabled={busy}
      onChange={event => { setSlotId(event.target.value); setItems([]); setCursor(null); setChoice(""); setReview(null); setConfirmed(false); }}>
      <option value="">请选择</option>{mediaSlots.map(slot => <option key={slot.id} value={slot.id}>{slot.label}</option>)}
    </select>
    <p id="history-slot-label" className="break-words">当前选择：{slot?.label || "未选择"}</p>
    <div className="flex flex-wrap gap-3">
      <button className="feature-button" type="button" disabled={!slotId || busy} onClick={() => read()}>读取历史</button>
      {cursor && <button className="feature-button" type="button" disabled={busy} onClick={() => read(false, cursor)}>下一页历史</button>}
    </div>
    <label htmlFor="history-version" className="block mt-4">历史版本</label>
    <select id="history-version" className="block w-full border p-2 my-2" value={choice} disabled={busy || !items.length}
      onChange={event => { setChoice(event.target.value); setReview(null); setConfirmed(false); }}>
      <option value="">请选择</option>{items.flatMap(item => (["candidate", "previous"] as const).filter(side => item[side]).map(side =>
        <option key={`${item.id}:${side}`} value={`${item.id}:${side}`}>{side === "candidate" ? "候选/留存草稿" : "当时旧公开版本"} · {item[side]!.revision} · {item.id.slice(0, 8)}</option>))}
    </select>
    <button className="feature-button" type="button" disabled={!choice || busy} onClick={() => read(true)}>读取所选版本并比较</button>
    {target && <dl className="my-4 space-y-4">{(["assetId", "alt", "caption"] as const).map(field => <div key={field} className="break-words">
      <dt>{({ assetId: "素材标识", alt: "替代说明", caption: "图注" })[field]}{review?.current.placement?.[field] === target[field] ? " · 相同" : " · 将改变"}</dt>
      <dd>当前草稿：{review?.current.placement?.[field] || "（空）"}</dd><dd>恢复版本：{target[field] || "（空）"}</dd>
    </div>)}</dl>}
    <label className="block my-4"><input type="checkbox" checked={confirmed} disabled={!review || busy} onChange={event => setConfirmed(event.target.checked)} /> 恢复为草稿，不修改线上内容；保留当前草稿</label>
    <button className="feature-button" type="button" disabled={!review || !confirmed || busy} onClick={restore}>确认恢复为私有草稿</button>
    <p role="status" aria-live="polite" className="break-words my-4">{message}</p>
    {slot && <a className="feature-button" href={`/admin/preview?path=${encodeURIComponent(slot.path)}`} target="_blank" rel="noopener noreferrer">打开整页草稿预览 ↗</a>}
  </section>;
}
