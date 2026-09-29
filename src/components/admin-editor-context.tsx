"use client";

import { createContext, useContext } from "react";
import { mediaSlots } from "../lib/media.ts";
import type { EditorState } from "../lib/editor-page.ts";

export const AdminEditorContext = createContext<{
  editing: boolean; states: Record<string, EditorState>; selectSlot: (id: string) => void;
} | null>(null);

export function AdminSlotButton({ slotId }: { slotId: string }) {
  const editor = useContext(AdminEditorContext);
  if (!editor?.editing) return null;
  const slot = mediaSlots.find(slot => slot.id === slotId);
  if (!slot) return null;
  const state = editor.states[slotId];
  return <button type="button" className="admin-slot-button" onClick={() => editor.selectSlot(slotId)} lang="zh-CN">
    <strong>＋ 上传 / 替换</strong><span>{slot.label}</span><small>{state?.message}</small>
  </button>;
}
