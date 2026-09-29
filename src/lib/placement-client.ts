import type { MediaPlacement } from "./media.ts";

export async function saveDraft(placement: MediaPlacement, revision: string | null, transport = fetch) {
  const response = await transport("/api/admin/placements", { method: "POST", credentials: "same-origin",
    cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ placement, revision }) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "草稿保存失败。");
  if (data.saved !== true || data.published !== false) throw new Error("无法确认草稿保存结果，请重新读取后确认。");
}
