"use client";

import { useRef, useState } from "react";
import { mediaSlots, } from "@/lib/media";
import { saveDraft } from "@/lib/placement-client";
import { AdminPreview } from "./admin-preview";

export function AdminPlacement({ assetId, kind }: { assetId: string; kind: "image" | "video" }) {
  const [slotId, setSlotId] = useState("");
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [revision, setRevision] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("选择展示位置后，先读取该位置的草稿。");
  const running = useRef(false);

  async function read() {
    if (!slotId || running.current) return;
    running.current = true; setBusy(true); setLoaded(false);
    try {
      const response = await fetch(`/api/admin/placements?slotId=${encodeURIComponent(slotId)}`, {
        credentials: "same-origin", cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法读取草稿。");
      if (data.revision !== null && typeof data.revision !== "string") throw new Error("草稿版本无效。");
      setRevision(data.revision);
      setAlt(typeof data.placement?.alt === "string" ? data.placement.alt : "");
      setCaption(typeof data.placement?.caption === "string" ? data.placement.caption : "");
      setLoaded(true);
      setMessage(data.placement ? "该位置已有草稿。保存将替换为本次上传的素材，请确认说明。" : "该位置暂无草稿，请填写说明。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "读取失败。"); }
    finally { running.current = false; setBusy(false); }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || running.current) return;
    running.current = true; setBusy(true);
    try {
      await saveDraft({ slotId, assetId, alt, caption }, revision);
      setMessage("展示位置草稿已保存，尚未发布。再次修改前请重新读取版本。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败。"); }
    finally { setLoaded(false); running.current = false; setBusy(false); }
  }

  return <section aria-labelledby="placement-heading" className="mt-8">
    <h3 id="placement-heading">设置展示位置 · 草稿</h3>
    <AdminPreview key={assetId} assetId={assetId} kind={kind} />
    <form onSubmit={save}>
      <label htmlFor="placement-slot">展示位置</label>
      <select id="placement-slot" aria-describedby="placement-slot-label" className="block w-full border p-2 my-2" value={slotId} disabled={busy}
        onChange={event => { setSlotId(event.target.value); setLoaded(false); }}>
        <option value="">请选择</option>
        {mediaSlots.filter(slot => slot.kinds.includes(kind)).map(slot => <option key={slot.id} value={slot.id}>{slot.label}</option>)}
      </select>
      <p id="placement-slot-label" className="break-words">当前选择：{mediaSlots.find(slot => slot.id === slotId)?.label || "未选择"}</p>
      <button type="button" className="feature-button disabled:opacity-50" disabled={!slotId || busy} onClick={read}>读取该位置草稿</button>
      <label htmlFor="placement-alt" className="block mt-4">替代说明（必填，最多 300 字）</label>
      <input id="placement-alt" className="block w-full border p-2 my-2" value={alt} required maxLength={300}
        disabled={!loaded || busy} onChange={event => setAlt(event.target.value)} />
      <label htmlFor="placement-caption">图注（可选，最多 2000 字）</label>
      <textarea id="placement-caption" className="block w-full border p-2 my-2" value={caption} maxLength={2000}
        disabled={!loaded || busy} onChange={event => setCaption(event.target.value)} />
      <button type="submit" className="feature-button disabled:opacity-50" disabled={!loaded || busy}>保存位置草稿</button>
    </form>
    <p role="status" aria-live="polite">{message}</p>
    {slotId && <p><a className="feature-button" href={`/admin/preview?path=${encodeURIComponent(mediaSlots.find(slot => slot.id === slotId)!.path)}`} target="_blank" rel="noopener noreferrer">打开整页草稿预览 ↗</a><small className="block mt-2">预览只读取已保存的草稿；未保存的输入不会显示。</small></p>}
  </section>;
}
