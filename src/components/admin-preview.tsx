"use client";

import { useState } from "react";

export function AdminPreview({ assetId, kind }: { assetId: string; kind: "image" | "video" }) {
  const [attempt, setAttempt] = useState(0);
  const [message, setMessage] = useState("正在读取私有预览…");
  const url = `/api/admin/media?assetId=${encodeURIComponent(assetId)}&role=`;
  const failed = () => setMessage("预览不可用：素材可能尚未处理完成、登录已过期或服务暂不可用。可稍后重试；原文件不会公开。");
  const loaded = () => setMessage("私有素材预览，尚未发布。这不是整页排版预览。");
  return <figure className="my-6">
    {kind === "video" ? <video key={attempt} className="w-full max-h-[60vh]" controls playsInline preload="metadata"
      aria-label="所选视频的私有预览" src={`${url}video`} poster={`${url}poster`} onLoadedData={loaded} onError={failed} /> :
      // Private authenticated bytes must not pass through Next's shared image optimizer.
      // eslint-disable-next-line @next/next/no-img-element
      <img key={attempt} className="w-full max-h-[60vh] object-contain" alt="所选图片的私有预览"
        src={`${url}detail`} onLoad={loaded} onError={failed} />}
    <figcaption role="status" aria-live="polite" className="my-2">{message}</figcaption>
    <button type="button" className="feature-button" onClick={() => { setMessage("正在重新读取私有预览…"); setAttempt(value => value + 1); }}>重新读取预览</button>
  </figure>;
}
