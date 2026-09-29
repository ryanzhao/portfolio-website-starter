import Link from "next/link";
import { headers } from "next/headers";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { AdminAuthError, readAdminConfig, requireAdmin } from "@/lib/admin-auth";
import { contentClient } from "@/lib/content-client";
import { readDraftPage } from "@/lib/draft-page";
import type { UploadStorage } from "@/lib/upload-http";
import { CanvaHome } from "@/components/canva-home";
import { WorkContent } from "@/components/work-content";
import { portfolioSections } from "@/lib/portfolio";
import { mediaSlots } from "@/lib/media";
import { AdminPublish } from "@/components/admin-publish";
import { LayoutProvider } from "@/components/layout-context";
import { readPageLayouts } from "@/lib/layout-store";

export const dynamic = "force-dynamic";
export const metadata = { title: "私有整页预览", robots: { index: false, follow: false } };
export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ path?: string; layoutPublication?: string }> }) {
  let preview: Awaited<ReturnType<typeof readDraftPage>>;
  let layouts: Awaited<ReturnType<typeof readPageLayouts>> | undefined;
  let layoutPublication = false;
  try {
    const config = readAdminConfig(process.env);
    const identity = await requireAdmin(new Request(`${config.origin}/admin/preview`, { headers: await headers() }), config);
    const { path = "/", layoutPublication: publication } = await searchParams;
    layoutPublication = path === "/" && publication === "1";
    const { env } = await getCloudflareContext({ async: true });
    const { UPLOADS, ORIGINALS } = env as unknown as UploadStorage;
    preview = layoutPublication ? { path: "/", media: {}, revisions: {}, publicRevisions: {} } : await readDraftPage(UPLOADS, ORIGINALS, contentClient(process.env), identity.subject, path);
    if (path === "/") layouts = await readPageLayouts(contentClient(process.env));
  } catch (error) {
    return <section className="page-section" lang="zh-CN"><h1>无法打开私有预览</h1><p>{error instanceof AdminAuthError ? error.message : "请确认草稿素材已处理完成、页面有效且内容服务可用。"}</p><Link href="/admin">返回后台</Link></section>;
  }
  const section = portfolioSections.find(section => preview.path === `/work/${section.slug}`);
  return <><aside className="notice" lang="zh-CN"><strong>私有草稿预览 · 尚未发布</strong><p>{layoutPublication ? "布局发布预览：已保存的布局草稿搭配已发布媒体，未发布媒体不会被带入。" : `页面链接会跳转到公开页面，不会自动跟随草稿。当前预览了 ${Object.keys(preview.revisions).length} 个草稿位置。`}</p><Link href="/admin">返回后台</Link></aside>
    {section ? <WorkContent section={section} media={preview.media} /> : <LayoutProvider layout={layouts!.layout}><CanvaHome media={layoutPublication ? undefined : preview.media} /></LayoutProvider>}
    <AdminPublish enabled={process.env.PUBLICATION_ENABLED === "true"} slots={Object.entries(preview.revisions).map(([id, revision]) => ({ id, revision,
      label: mediaSlots.find(slot => slot.id === id)!.label, previousRevision: preview.publicRevisions[id] }))} /></>;
}
