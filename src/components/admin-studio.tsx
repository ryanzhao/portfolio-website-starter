"use client";

import { useMemo } from "react";
import { NextStudio } from "next-sanity/studio";
import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { schemaTypes } from "@/sanity/schema";
import type { StudioConnection } from "@/lib/studio-config";

// https://www.sanity.io/docs/nextjs/embedding-sanity-studio-in-nextjs
export function AdminStudio({ connection }: { connection: StudioConnection }) {
  const config = useMemo(() => defineConfig({
    name: "portfolio", title: "Ryan Zhao · 内容工作台", basePath: "/admin/studio",
    projectId: connection.projectId, dataset: connection.dataset,
    plugins: [structureTool({ title: "内容编辑" })],
    schema: { types: schemaTypes },
    // Native publication must not bypass R2 readiness/snapshot checks.
    // Draft editing is available; server-verified publication is added separately.
    document: { actions: () => [] },
  }), [connection.projectId, connection.dataset]);
  return <div className="admin-studio" lang="zh-CN"><NextStudio config={config} /></div>;
}
