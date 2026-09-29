import Link from "next/link";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AdminAuthError, readAdminConfig, requireAdmin } from "@/lib/admin-auth";
import { contentClient } from "@/lib/content-client";
import { readEditorPage } from "@/lib/editor-page";
import type { UploadStorage } from "@/lib/upload-http";
import { CanvaHome } from "@/components/canva-home";
import { WorkContent } from "@/components/work-content";
import { AdminEditor } from "@/components/admin-editor";
import { portfolioSections } from "@/lib/portfolio";
import { readPageLayouts } from "@/lib/layout-store";

export const dynamic = "force-dynamic";
export const metadata = { title: "页面编辑", robots: { index: false, follow: false } };
export default async function Admin({ searchParams }: { searchParams: Promise<{ path?: string }> }) {
  let page: Awaited<ReturnType<typeof readEditorPage>>;
  let layout: Awaited<ReturnType<typeof readPageLayouts>> | undefined;
  try {
    const config = readAdminConfig(process.env);
    const identity = await requireAdmin(new Request(`${config.origin}/admin`, { headers: await headers() }), config);
    const { path = "/" } = await searchParams;
    const { env } = await getCloudflareContext({ async: true });
    const { UPLOADS, ORIGINALS } = env as unknown as UploadStorage;
    page = await readEditorPage(UPLOADS, ORIGINALS, contentClient(process.env), identity.subject, path);
    if (path === "/") layout = await readPageLayouts(contentClient(process.env));
  } catch (error) {
    return <section className="page-section" lang="zh-CN"><h1>无法打开页面编辑器</h1><p>{error instanceof AdminAuthError ? error.message : "请检查页面地址和内容服务连接。已保存的数据不会因此丢失。"}</p><Link href="/admin">重新打开首页编辑</Link><p><Link href="/admin/advanced">高级管理 / 连接检查</Link></p></section>;
  }
  const section = portfolioSections.find(section => page.path === `/work/${section.slug}`);
  return <AdminEditor key={page.path} path={page.path} states={page.states} publishSlots={page.publishSlots} enabled={process.env.PUBLICATION_ENABLED === "true"} layoutState={layout}>
    {section ? <WorkContent section={section} media={page.media} /> : <CanvaHome media={page.media} />}
  </AdminEditor>;
}
