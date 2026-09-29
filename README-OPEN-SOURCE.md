# Build your own portfolio website

**Language / 语言:** [简体中文](README-OPEN-SOURCE.zh-CN.md) · [English](README-OPEN-SOURCE.md)

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
