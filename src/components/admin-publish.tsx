"use client";

import { useRef, useState } from "react";

export function AdminPublish({ slots, enabled, onBusyChange }: { slots: { id: string; label: string; revision: string; previousRevision: string | null }[]; enabled: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [selected, setSelected] = useState(slots[0]?.id || "");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [used, setUsed] = useState(false);
  const [message, setMessage] = useState(enabled ? "请先核对整页效果，再确认要发布的位置。" : "公开发布尚未启用，等待首次发布确认与验收。");
  const running = useRef(false);
  async function publish(event: React.FormEvent) {
    event.preventDefault();
    const slot = slots.find(slot => slot.id === selected);
    if (!enabled || !confirmed || !slot || used || running.current) return;
    running.current = true; setBusy(true); setUsed(true); onBusyChange?.(true);
    try {
      const response = await fetch("/api/admin/publish", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ slotId: slot.id, revision: slot.revision, previousRevision: slot.previousRevision, confirmed: true }) });
      const result = await response.json();
      if (!response.ok || result.published !== true) throw new Error(result.error || "发布未确认，请核对当前公开版本。");
      setMessage("该位置已提交发布。请打开公开页面核对；继续编辑前请重新加载预览。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "发布未确认，请核对当前公开版本，不要直接重试。"); }
    finally { running.current = false; setBusy(false); setConfirmed(false); onBusyChange?.(false); }
  }
  return <form onSubmit={publish} className="my-4" lang="zh-CN">
    <label htmlFor="publish-slot">本次发布位置（一次一个）</label>
    <select id="publish-slot" aria-describedby="publish-slot-label" className="block w-full border p-2 my-2" value={selected} disabled={busy || used || !slots.length}
      onChange={event => { setSelected(event.target.value); setConfirmed(false); }}>
      {slots.map(slot => <option key={slot.id} value={slot.id}>{slot.label}</option>)}
    </select>
    <p id="publish-slot-label" className="break-words">当前选择：{slots.find(slot => slot.id === selected)?.label || "未选择"}</p>
    <label className="block my-3"><input type="checkbox" checked={confirmed} disabled={!enabled || busy || used || !selected}
      onChange={event => setConfirmed(event.target.checked)} /> 我已核对该位置的素材和说明，确认公开展示。</label>
    <button className="feature-button disabled:opacity-50" type="submit" disabled={!enabled || !confirmed || busy || used || !selected}>发布所选位置</button>
    {used && <button className="feature-button ml-2" type="button" disabled={busy} onClick={() => window.location.reload()}>重新加载预览</button>}
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
