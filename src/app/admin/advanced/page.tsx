import Link from "next/link";
import { readStudioConfig } from "@/lib/studio-config";
import { AdminUpload } from "@/components/admin-upload";
import { AdminHistory } from "@/components/admin-history";

export const metadata = { title: "高级管理", robots: { index: false, follow: false } };
export default function Admin() {
  const studioConfigured = Boolean(readStudioConfig(process.env));
  return <section className="page-section" lang="zh-CN">
    <Link href="/admin">← 返回页面编辑</Link>
    <p className="eyebrow">高级管理 / 上传续传与恢复</p><h1>高级管理</h1>
    <p className="page-intro">上传私有素材 → 电脑处理 → 选择展示位置并保存草稿 → 预览 → 逐项确认发布。上传总额度以后台配置为准；主站尚未切换，后台仍仅本人可访问。</p>
    {/* Full navigation is required for the Cloudflare logout endpoint. */}
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
    <a className="feature-button" href="/cdn-cgi/access/logout">退出 Access 登录</a>
    <p className="fine-print">请先完成上传并保存草稿。退出会结束同一 Cloudflare Access 组织下所有应用的登录；Sanity 登录独立。未保存的输入可能丢失，已保存草稿和服务器上传记录保留。</p>
    <AdminUpload />
    <AdminHistory />
    <div className="notice"><h2>内容编辑器</h2><p>{studioConfigured ? "已填写 Sanity 项目配置。素材展示位置可直接在上方保存；Studio 编辑器需另行登录与验证。" : "本环境未配置 Sanity 项目。"}编辑器保存草稿不等于发布。</p><Link className="feature-button" href="/admin/studio">打开内容编辑入口 ↗</Link></div>
    <dl className="service-list">{[
      ["Sanity 内容管理", studioConfigured ? "已配置 · 草稿保存结果以操作提示为准" : "本环境未配置"],
      ["Cloudflare R2 素材库", "原文件保持私有；上传与校验状态见素材记录"],
      ["本机媒体处理", "电脑需联网并运行处理程序；处理完成后刷新素材列表"],
      ["NAS / OneDrive 同步", "由你手动同步，不属于本次自动化范围"],
      ["历史与恢复", "展示位置快照与恢复为私有草稿已验收；不等于整站灾难恢复"]
    ].map(([name, status]) => <div key={name}><dt>{name}</dt><dd>{status}</dd></div>)}</dl>
    <p className="fine-print">上传、处理和公开发布是不同状态。管理 API 会独立校验身份，不因能打开本页而放行。</p>
  </section>;
}
