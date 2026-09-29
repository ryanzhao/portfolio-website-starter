import Link from "next/link";
import { headers } from "next/headers";
import { AdminStudioLoader } from "@/components/admin-studio-loader";
import { readStudioConfig } from "@/lib/studio-config";
import { AdminAuthError, readAdminConfig, requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "内容编辑", robots: { index: false, follow: false } };

export default async function StudioPage() {
  const connection = readStudioConfig(process.env);
  if (!connection) return <section className="page-section" lang="zh-CN"><h1>Sanity 尚未配置</h1><p>需要先创建并授权连接 Sanity 项目。当前没有可用的云端内容编辑器。</p><Link href="/admin">返回管理入口</Link></section>;
  try {
    const config = readAdminConfig(process.env);
    await requireAdmin(new Request(`${config.origin}/admin/studio`, { headers: await headers() }), config);
  } catch (error) {
    return <section className="page-section" lang="zh-CN"><h1>需要管理员身份</h1><p>{error instanceof AdminAuthError ? error.message : "身份验证服务暂时不可用。"}</p><Link href="/admin">返回管理入口</Link></section>;
  }
  return <AdminStudioLoader connection={connection} />;
}
