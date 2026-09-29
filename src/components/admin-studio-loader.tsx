"use client";

import dynamic from "next/dynamic";
import type { StudioConnection } from "@/lib/studio-config";

// Keep Studio's browser/font side effects out of unconfigured/unauthorized pages.
const Studio = dynamic(() => import("./admin-studio").then(module => module.AdminStudio), {
  ssr: false, loading: () => <p role="status" lang="zh-CN">正在加载内容编辑器…</p>,
});
export function AdminStudioLoader({ connection }: { connection: StudioConnection }) {
  return <Studio connection={connection} />;
}
