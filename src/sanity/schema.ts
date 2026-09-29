import type { SchemaTypeDefinition } from "sanity";
import { mediaSlots } from "../lib/media.ts";

// Sanity content schemas: https://www.sanity.io/docs/studio/schema-types
// Media uses our R2-backed IDs, never Sanity's public image/file upload fields.
export const schemaTypes: SchemaTypeDefinition[] = [
  {
    name: "siteSettings", title: "网站设置", type: "document",
    fields: [
      { name: "name", title: "姓名", type: "string", validation: r => r.required().max(100) },
      { name: "identity", title: "简短身份", type: "string", validation: r => r.max(200) },
      { name: "currentFocus", title: "当前方向", type: "text", rows: 3 },
      { name: "email", title: "公开联系邮箱", type: "string", validation: r => r.email() },
      { name: "description", title: "默认搜索摘要", type: "text", rows: 3, validation: r => r.max(300) },
    ],
  },
  {
    name: "project", title: "项目", type: "document",
    fields: [
      { name: "title", title: "标题", type: "string", validation: r => r.required().max(200) },
      { name: "slug", title: "网址标识", type: "slug", options: { source: "title", maxLength: 96 }, validation: r => r.required() },
      { name: "summary", title: "摘要", type: "text", rows: 3, validation: r => r.required().max(1000) },
      { name: "status", title: "状态", type: "string", options: { list: ["Active", "Completed", "Paused", "Research"] }, validation: r => r.required() },
      { name: "category", title: "类别", type: "string" },
      { name: "tags", title: "标签", type: "array", of: [{ type: "string" }] },
      { name: "role", title: "个人职责", type: "string" },
      { name: "technologies", title: "技术", type: "array", of: [{ type: "string" }] },
      { name: "startDate", title: "开始日期", type: "date" },
      { name: "endDate", title: "结束日期", type: "date" },
      { name: "featured", title: "精选", type: "boolean", initialValue: false },
      { name: "featuredOrder", title: "精选排序", type: "number", validation: r => r.integer().min(0) },
      { name: "contentBlocks", title: "项目正文", type: "array", of: [{ type: "block" }] },
    ],
  },
  {
    name: "update", title: "工程日志", type: "document",
    fields: [
      { name: "title", title: "标题", type: "string", validation: r => r.required().max(200) },
      { name: "slug", title: "网址标识", type: "slug", options: { source: "title" }, validation: r => r.required() },
      { name: "date", title: "日期", type: "datetime", validation: r => r.required() },
      { name: "summary", title: "摘要", type: "text", rows: 3 },
      { name: "projectReferences", title: "相关项目", type: "array", of: [{ type: "reference", to: [{ type: "project" }] }] },
      { name: "contentBlocks", title: "正文", type: "array", of: [{ type: "block" }] },
    ],
  },
  {
    name: "about", title: "个人介绍", type: "document",
    fields: [
      { name: "intro", title: "简介", type: "text", rows: 4 },
      { name: "education", title: "教育", type: "array", of: [{ type: "block" }] },
      { name: "experience", title: "经历", type: "array", of: [{ type: "block" }] },
      { name: "interests", title: "兴趣", type: "array", of: [{ type: "string" }] },
      { name: "currentWork", title: "当前工作", type: "text" },
    ],
    preview: { prepare: () => ({ title: "个人介绍" }) },
  },
  {
    name: "mediaAsset", title: "素材记录（由上传服务维护）", type: "document", readOnly: true,
    fields: [
      { name: "assetId", title: "素材 ID", type: "string" },
      { name: "originalFilename", title: "原文件名", type: "string" },
      { name: "mimeType", title: "文件类型", type: "string" },
      { name: "size", title: "字节数", type: "number" },
      { name: "checksum", title: "SHA-256", type: "string" },
      { name: "width", title: "宽度", type: "number" },
      { name: "height", title: "高度", type: "number" },
      { name: "duration", title: "时长（秒）", type: "number" },
      { name: "privateOriginalKey", title: "私有原件标识（仅限私有文档）", type: "string", hidden: true },
      { name: "publicVariantKeys", title: "已验证网页衍生文件", type: "array", of: [{ type: "string" }] },
      { name: "posterKey", title: "视频封面标识", type: "string" },
      { name: "processingStatus", title: "处理状态", type: "string", options: { list: ["pending", "processing", "ready", "failed"] } },
      { name: "visibility", title: "可见性", type: "string", options: { list: ["private", "published"] } },
    ],
    preview: { select: { title: "originalFilename", subtitle: "processingStatus" } },
  },
  {
    name: "mediaPlacement", title: "页面素材位置", type: "document",
    fields: [
      { name: "slotId", title: "展示位置", type: "string", options: { list: mediaSlots.map(s => ({ title: s.label, value: s.id })) }, validation: r => r.required() },
      { name: "assetId", title: "素材 ID", type: "string", description: "由素材选择器填写；发布时服务端验证素材状态。", validation: r => r.required() },
      { name: "alt", title: "替代说明", type: "string", validation: r => r.required().max(300) },
      { name: "caption", title: "图注", type: "text", rows: 3, validation: r => r.max(2000) },
    ],
    preview: { select: { title: "slotId", subtitle: "alt" } },
  },
];
