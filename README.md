# Ryan Zhao — engineering portfolio starter

**Language / 语言:** [简体中文（本页）](#简体中文) · [English (this page)](#english)

README 内容已在本页完整展开。语言链接只切换到本页对应内容位置；也可以打开独立的[中文快速开始](README-OPEN-SOURCE.zh-CN.md)或[英文快速开始](README-OPEN-SOURCE.md)。

README content is fully expanded on this page. The language links jump to the matching section; standalone guides are also available in [English](README-OPEN-SOURCE.md) and [简体中文](README-OPEN-SOURCE.zh-CN.md).

[Website build journey / 建站过程](docs/WEBSITE-BUILD-JOURNEY-EN.md)

<a id="english"></a>
# English

This repository is a reusable starter and learning guide based on an engineering portfolio project. It shows how to move from a visual reference to a responsive site, then add content editing and media workflows in independently verifiable steps. This starter is a personal portfolio example; reuse the code and workflow, and replace its identity and project content with your own.

## What is included

- Responsive portfolio pages built with Next.js App Router, React, TypeScript, and Tailwind CSS.
- A visual site editor and content/media workflow built around Sanity and Cloudflare services.
- Local development, tests, and Cloudflare Workers build configuration.
- A [bilingual project journey](docs/WEBSITE-BUILD-JOURNEY-EN.md) describing the process, decisions, and lessons learned.

This is a source-code starter, not a one-click hosted service. Cloud admin, uploads, CMS, and publishing need your own accounts, resource bindings, secrets, and review. You can use the visual frontend without configuring those services; do not deploy the admin/backend until you have configured and tested its trust boundaries.

## Quick start

Requirements: Node.js 24.14.x and npm. From the repository root:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. To build and preview through the local Workers runtime:

```sh
npm run build:worker
npm run preview
```

In a second terminal, run the HTTP smoke check:

```sh
npm run smoke
```

Check the source before sharing changes:

```sh
npm run lint
npm run typecheck
npm test
```

## A practical path for your own site

1. **Choose a small first release.** Write down the pages, audience, real content, and devices you need to support. Keep uncertain facts out of the published copy.
2. **Collect design references and real assets.** Record what you observed. Use labeled placeholders when you do not own or cannot verify an image, font, logo, or claim.
3. **Build a local frontend first.** Replace the example content and components in `src/`, then check the layout at phone, tablet, and desktop widths.
4. **Add validation.** Run lint, type checks, tests, and the target-platform build. A passing local build does not verify a cloud deployment.
5. **Add a CMS only if editing requires it.** Create your own project and dataset; put server credentials in your deployment platform’s secret store or ignored local env file. Never commit real credentials or production account IDs.
6. **Treat media upload and publication as separate actions.** Validate stored bytes and derivatives, preview the result privately, then publish explicitly. Keep originals private and preserve a usable prior release.
7. **Deploy only after a live checklist.** Verify identity checks, storage isolation, domain bindings, logs, costs, and rollback. Keep a recovery copy outside the deployment.

## Configure before using Cloudflare or Sanity

The checked-in `wrangler.jsonc` is a local-only configuration template with placeholder resource names and `remote: false`. The service-specific production configurations are not included in this open-source snapshot. Create your own R2 buckets and D1 database, apply migrations to a non-production environment first, and bind them in a private config file that is excluded from Git.

For optional Sanity/Access settings, copy `.env.example` to an ignored local file and fill only values for resources you own. Server secrets must never use a `NEXT_PUBLIC_` prefix. Review Cloudflare Workers and OpenNext documentation for current setup requirements before deploying.

The admin/media implementation is reusable code, but a public production admin is not safe merely because it builds. Configure a real identity provider, administrator allowlist, exact allowed origins, quotas, private/public bucket separation, and server-side verification. Do not enable publishing until you have tested the authenticated end-to-end flow.

## Replace the personal design

The example portfolio uses placeholder image slots and draft project text. Replace it with content and media you have permission to publish. The original Canva reference and personal media are not bundled. See `docs/DESIGN-PREVIEW.md` for the frontend replacement points and the bilingual journey for the design decisions.

## License and contribution

Code and documentation in this open-source snapshot are released under the [MIT License](LICENSE), except third-party dependencies and assets, which retain their own terms. Do not submit private media, credentials, personal account configurations, or unlicensed content in pull requests.

Issues and pull requests that improve setup clarity, accessibility, or reusable components are welcome. Please include the environment and exact steps needed to reproduce a bug.


---

<a id="简体中文"></a>

# 简体中文

这个仓库是一个可复用的网站起点和学习指南，整理自一个工程作品集项目。你可以从视觉参考开始，搭建响应式页面，再分阶段加入内容编辑和媒体工作流，并分别验证每个阶段。它是个人作品集示例；欢迎复用代码和流程，请将身份信息与项目内容替换成你自己的。

## 仓库包含什么

- 使用 Next.js App Router、React、TypeScript 和 Tailwind CSS 构建的响应式作品集页面。
- 基于 Sanity 与 Cloudflare 服务的可视化编辑器、内容和媒体工作流代码。
- 本地开发、测试和 Cloudflare Workers 构建配置。
- 记录开发过程、技术选择和经验的[中英文建站记录](docs/WEBSITE-BUILD-JOURNEY-ZH.md)。

这是源码模板，不是开箱即用的托管服务。云端管理后台、上传、CMS 和发布功能需要你自己的账户、资源绑定、密钥配置和安全审查。只使用前端页面时，可以不配置这些服务；在信任边界配置和验证完成前，不要部署后台或启用发布。

## 快速开始

需要 Node.js 24.14.x 和 npm。在仓库根目录运行：

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:3000`。如需用本地 Workers 运行时构建和预览：

```sh
npm run build:worker
npm run preview
```

在另一个终端执行 HTTP 冒烟检查：

```sh
npm run smoke
```

分享改动前可运行：

```sh
npm run lint
npm run typecheck
npm test
```

## 搭建自己的网站：建议步骤

1. **先确定一个小版本的范围。** 写下目标读者、页面、真实内容和需要支持的设备。尚未确认的信息不要放进公开文案。
2. **收集设计参考和真实素材。** 记录实际观察到的内容。如果图片、字体、Logo 或经历无法确认或没有使用权，就放置清楚标注的占位内容。
3. **先完成本地前端。** 在 `src/` 中替换示例内容与组件，并分别检查手机、平板和桌面布局。
4. **增加验证步骤。** 运行 lint、类型检查、测试和目标平台构建。本地构建通过不等于云端部署已经验证。
5. **确实需要多人编辑时再接 CMS。** 创建自己的项目和数据集；服务端密钥放在平台密钥管理处或 Git 忽略的本地环境文件中。不要提交真实凭据或生产账户 ID。
6. **上传与发布分开处理。** 验证存储字节和衍生文件，先私下预览，再明确发布。原件保持私有，并保留一个可用的上一版本。
7. **完成上线清单后再部署。** 核实身份校验、存储隔离、域名绑定、日志、费用和回滚方式；在部署环境之外保留恢复副本。

## 使用 Cloudflare 或 Sanity 前先配置

仓库中的 `wrangler.jsonc` 是本地配置模板，资源名称使用占位值，并设为 `remote: false`。生产环境专用的 Worker 配置没有放进这个开源快照。请创建自己的 R2 bucket 和 D1 数据库，先在非生产环境应用迁移，再通过不纳入 Git 的私有配置绑定资源。

如需使用 Sanity/Access，请把 `.env.example` 复制为 Git 忽略的本地环境文件，并只填写你自己拥有的资源值。服务端密钥绝不能使用 `NEXT_PUBLIC_` 前缀。部署前请查阅当前版本的 Cloudflare Workers 和 OpenNext 官方配置说明。

后台与媒体代码可以复用，但“能构建”并不表示公开后台已经安全。需要配置真实身份提供商、管理员名单、精确允许的来源、配额、私有/公开 bucket 隔离和服务端校验。完成认证端到端验收前，不要启用发布。

## 替换个人设计与素材

示例作品集使用图片占位区和草稿项目文字。请替换成你有权发布的内容与素材。原 Canva 参考页面和个人素材没有包含在仓库中。前端替换点见 `docs/DESIGN-PREVIEW.md`；设计过程与实现记录见中英文建站文档。

## 许可证与贡献

这个开源快照中的代码和文档采用 [MIT 许可证](LICENSE)；第三方依赖和素材仍遵守各自条款。请勿在 Pull Request 中提交私人素材、凭据、个人账户配置或没有授权的内容。

欢迎提交能改善安装说明、无障碍体验和通用组件的 Issue 或 Pull Request。报告问题时请提供运行环境和可复现步骤。


---

# MIT License

MIT License

Copyright (c) 2026 Ryan Zhao

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
