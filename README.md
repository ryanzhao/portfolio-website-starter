# Ryan Zhao Engineering Portfolio: The Website Build Journey

**Language:** English · [中文](README.zh-CN.md)

The full build record is below. To start your own site, use the [English setup guide](README-OPEN-SOURCE.md).

> This account is based on the project’s Git history, `PLANS.md`, implementation and acceptance records in `docs/`, and local Codex rollout metadata. It is current through **September 29, 2026**. Dates and outcomes are included only where supported by project evidence. Design goals, deployed code, published content, and backup acceptance are treated as separate things. Original Codex session files remain local; this is not a verbatim conversation export.

## 1. How the project began

The goal was to build an engineering portfolio for Ryan Zhao, presenting an introduction, engineering projects, and experiments or fabrication work in a format that works on desktop and mobile. The initial visual reference was a Canva page. Over time, the scope expanded to include a protected content admin, media upload and processing, a visual page editor, private previews, and separate code deployment and content publication workflows.

The September 19, 2026 project plan records that the target directory was first inspected and found empty. Its parent Git configuration pointed to an unrelated DIY-Drone-resources repository, so the portfolio received its own repository instead of reusing that remote. The local Node/npm setup and compatibility among Next.js, OpenNext, and Wrangler were checked. An existing Windows `Codex Conversation Archive` scheduled task was also found and marked for reuse rather than duplication. Existing Sanity and Cloudflare accounts/projects were confirmed. New cloud resources, paid plans, domain changes, and the first public release were handled as separately authorized steps.

## 2. Platforms and technologies

| Area | Current choice | Role and boundary |
|---|---|---|
| Web application | Next.js App Router, React, strict TypeScript, Tailwind CSS | Pages, components, admin UI, and APIs; the same application code supports local and production builds. |
| Cloudflare runtime | OpenNext, Cloudflare Workers, Wrangler | Adapts and deploys the Next.js app to Workers; local Workers preview checks behavior in the target runtime. |
| Content and admin | Sanity Content Lake / Studio | Structured content and its editing UI. Authentication, publishing permissions, and content validation are separate security boundaries. |
| Media and jobs | Cloudflare R2 and D1 | Original media, published derivatives, and private backups are isolated; D1 stores operational upload and processing state. |
| Local model/media processing | Owner’s Windows PC and Node scripts; STEP conversion uses CadQuery/OpenCascade | Large CAD originals stay in the private workflow and are downloaded and converted on the PC into viewable GLB files. Visitors can load published derivatives without the PC online. |
| Design and acceptance | Canva reference, Chrome/browser checks, Node tests, local Workers smoke checks | Design reference and implementation verification. Screenshots and temporary test media stay in ignored local output, outside the public source archive. |
| Version history | Private GitHub repository `ryan-portfolio-archive`, feature branches `codex/...` | Stores code and project documentation. Content publication, Cloudflare Worker deployment, and website backups are separate operations from Git commits. |
| AI workflow | Codex Desktop with the local repository, terminal, and browser tools | Read specifications and local evidence, implement in reviewable steps, run suitable checks, verify actual browser/deployment state, record limits, and commit under project rules. Raw Codex history has a separate local archive workflow. |

Exact dependency versions are recorded in `package.json`, `package-lock.json`, and `.node-version`. The table is not a claim that upstream versions never change. Cloudflare and Sanity configuration, account plans, and deployed versions can change; read back the live state before reusing this process.

## 3. Implementation timeline

### Stage A: Build the local application foundation (September 19, 2026)

The first work established the Next.js/OpenNext structure, responsive starter pages, draft project content, an honest admin status page, noindex/preview boundaries, a health route, and local Workers configuration. It also created a path for lint, TypeScript checks, Node tests, OpenNext builds, and Workers HTTP smoke checks. The key boundary was explicit: a working local page does not prove that the CMS, media storage, identity service, or production website is connected.

An early Workers smoke check exposed a soft-404/streaming-boundary issue. Removing the loading boundary that caused the soft 404 and rerunning route checks fixed it. A Windows OneDrive cloud-reparse directory also caused `EPERM` while Next tried to clean a build directory. The old generated output was retained as recovery evidence, then a clean build succeeded without moving project originals. Results and limits are recorded in `docs/VERIFICATION.md`.

### Stage B: Reproduce the Canva design while leaving real-media slots (September 19, 2026)

The Canva reference was inspected in a browser at desktop and mobile widths. The notes captured the black hero, large serif title, off-white biography area, orange accents, three project-history lanes, and five themed sections. The homepage and five section pages were implemented with responsive navigation, keyboard interactions, and a vertical mobile timeline. Since the original photographs, logo artwork, and font identity were not available for confirmation, the site kept labeled photo slots. Georgia and a text MARS wordmark are temporary substitutes, not pixel-identical originals. No experiment imagery was generated or downloaded, and no unverified biography or project results were added.

The six pages were checked in browser viewports at 390, 768, 1024, 1440, and 1920 pixels: 30 viewport checks in total. A tablet-width overflow was fixed. Local Workers smoke checks, noindex behavior, and unknown-route responses passed. See `docs/DESIGN-REFERENCE.md` and `docs/VERIFICATION.md` for the exact scope and limits.

### Stage C: Grow the admin from a status page into an editing workflow (September 19–21, 2026)

Implementation proceeded from identity to data writes: Access JWT verification, an administrator allowlist, exact Origin checks, rate limits, upload sessions, multipart transfer, media placements, drafts, history snapshots, and restore-to-draft behavior. Sanity manages structured content and Studio; R2 separates private originals, public derivatives, and private backups; D1 records jobs and write limits. Publishing requires explicit confirmation and validation of the candidate pages and media. Uploading or saving alone never publishes content.

Early mocked/local tests proved only the local implementation. Real Access, Chrome, Sanity, R2, D1, and Worker readback checks were conducted separately afterward. Cloud behavior exposed JSON object-key ordering differences, Workers request-count limits, and concurrent-save conflicts. These were addressed with canonical content comparison, batched reads, and revision/CAS conflict protection. Exact versions, test results, and operation scope are recorded by date in `PLANS.md` and the related `docs/` pages; early plans should not be mistaken for final status.

### Stage D: Add a canvas-style website editor and recoverable editing (September 20–21, 2026)

The work expanded from a homepage block editor into a Canva-style site editor supporting shared navigation, cross-page drafts, element editing, undo, page creation, recycle/restore, and history snapshots. Specifications came first, followed by small implementation and verification steps. Cloud reads and writes had to stay within request limits; save comparisons had to tolerate JSON key reordering; and a changed remote revision had to preserve the user’s current input instead of silently overwriting concurrent edits.

Local and cloud Chrome acceptance were recorded separately. Verified save, undo, cross-page readback, and history access are distinguished from formal content publication and a full-site restore drill that was not performed. Evidence is in `docs/DESIGNER-ACCEPTANCE.md`, `docs/ROLLBACK.md`, and `PLANS.md`.

### Stage E: Media library, uploads, publishing, and the local processor (September 20 onward)

A shared media library was built with tags and placements, upload, resumable transfer, private preview, explicit publishing, history restoration, and failure-state preservation. Upload and processing are separate steps: an uploaded asset is not automatically a processed or public asset. The local processor keeps its configuration in a protected machine-only directory; secrets do not belong in the repository, command history, or web page. Machine identity is separate from human administrator authentication.

For CAD models, the workflow became STEP/STP → Windows PC → GLB, with input/output limits, timeouts, memory limits, and geometry-complexity checks. On September 26, a roughly 201 MB STEP download was truncated, and Cloudflare Worker Free CPU limits blocked the server-side path. The PC client was changed to download verified ranges. Once the Worker CPU limit was confirmed, conversion was not moved into a more expensive hosted service, and failure was not reported as success. User-supplied GLB files can be validated and uploaded directly, skipping conversion. Originals remain private.

### Stage F: Deploy the portfolio separately (September 28, 2026)

With the owner’s authorization, the portfolio was deployed to a dedicated public Worker on a separate subdomain. The owner’s existing site and protected admin Worker kept their separate purposes. The public configuration reads only published Sanity content and published R2 derivatives; it has no bindings to originals, backups, D1, or administrator credentials. Browser checks covered production routes, a real GLB, image/video range responses, and mobile width. Search indexing remains disabled.

Deploying Worker code and publishing content are separate operations. Verified GLB and page publications are documented individually. On September 28, the homepage publication check found the existing hero and chemistry image blocks outside their desktop bounds. The owner chose to preserve the layout and defer publication, so the private draft remains unpublished and the public content was not described as updated. A video gallery was later added to the private draft and playback verified. The Machining slot remains empty because the Thruster video has not been confirmed as belonging to that project.

### Stage G: Prepare and publish a separate open-source edition (September 29, 2026)

The existing portfolio archive remained private. A separate public repository, `ryanzhao/portfolio-website-starter`, received a fresh root commit containing only a reviewed starter snapshot. The export removed private project instructions, deployment configurations, account-specific resource values, raw CAD and personal media, and local secrets. The public configuration uses placeholders. The starter includes source code, an MIT license, setup guides, and this bilingual build record. Lint, type checking, the Workers build, and targeted tests passed before the initial publication.

The first Git HTTPS push failed because the local environment could not connect to GitHub on port 443. After the network permission was enabled, the push succeeded and the remote `main` commit was read back. GitHub Pages was then enabled from `main /docs` for an optional language-switching guide. GitHub's repository README does not run custom switching scripts, so the repository homepage now shows the complete English record directly and links to a complete Chinese Markdown version on GitHub. The Pages guide remains available for switching languages in place.

## 4. Problems encountered and how they were handled

| Problem | Response | Reusable lesson |
|---|---|---|
| Canva font, logo, and photos could not be confirmed | Use labeled placeholders/substitutes and record the visual differences | Do not present a substitute as an original; replace it after the source and usage rights are clear. |
| Tablet layout overflow | Constrain placeholder width, adjust card columns, and recheck several viewport sizes | Responsive breakpoints need real browser layout checks. |
| Next build cleanup failed with `EPERM` on a OneDrive cloud file | Preserve the old generated directory as recovery material, then rebuild | Do not move or delete user originals to work around a generated-output issue. |
| Upload completion was mistaken for media readiness | Add private processing state, verification, preview, and a separate publish step | Each external system needs readable state and an explicit failure path. |
| Sanity JSON key order looked like a content change | Compare canonicalized content while retaining revision checks | Semantic comparisons should not depend on object serialization order; concurrent writes still need version checks. |
| Large STEP download truncated / Worker CPU limit | Download verified ranges on the PC; keep the Worker coordinating; allow preconverted GLB | Run large compute on the selected processing machine; preserve originals and report failures honestly. |
| Multiple editor windows saved concurrently | Reread the latest revision and preserve the other editor’s changes on conflict | Never overwrite newer state with a stale draft; conflicts need an explicit recovery/retry path. |
| Homepage content blocks exceeded layout bounds | Block that content publication and preserve the private draft and current public version | Publication checks cover content state, not only whether code builds. |
| The local Git HTTPS connection to GitHub failed | Use the authorized network connection, retry the push, then read back the remote commit | Treat a failed push as unverified until the remote branch is confirmed. |
| GitHub README could not switch text in place | Show the full English record on the repository homepage and link to a full Chinese Markdown page | Use separate Markdown pages for language choice inside GitHub; an optional Pages site can switch in place. |

## 5. Reusable AI workflow

1. **Start from project rules and approved specifications.** Read `AGENTS.md`, `PLANS.md`, the relevant design specifications, and the existing architecture notes. Follow the latest explicit scope decisions when scope changes.
2. **Inspect the current state.** Check the branch, working tree, remote, existing cloud resources/page state, and relevant code. Do not assume a prior task’s state is still current.
3. **Break work into reviewable steps.** Define data flow, permissions, and failure behavior before implementation. Reuse existing components and platform features instead of building speculative abstractions.
4. **Report each kind of evidence separately.** Unit/integration tests, local Workers, real browser behavior, cloud deployment, actual content publication, and backup verification are different forms of evidence. Preserve original user media, drafts, and explicit publishing boundaries.
5. **Find the root cause of failures.** Record status codes, responses, versions, byte counts, and runtime limits. Protect existing data, then choose the smallest verifiable correction. Distinguish a timeout from a platform limit or unapproved content.
6. **Review side effects after changes.** Inspect the final diff, unrelated files, secrets/tokens, generated outputs, and original media. Stage only intended files for important code/documentation changes; after committing, push and verify the remote commit.
7. **Record reusable details.** Keep specifications, operating procedures, acceptance facts, and open limitations in `docs/` and `PLANS.md`. Ignored screenshots and test media stay local as evidence and are excluded from the source archive.

Codex can follow instructions to inspect and change code, analyze logs, run checks, and use authorized browser/platform access. It cannot infer real account state from local tests or replace the owner’s authorization for first publication, domain changes, spending, or publishing formal content. Original Codex conversations use a separate private archive workflow; this document summarizes project history without copying session JSONL, authentication settings, or credentials.

## 6. Reusing this process for another website

1. Before creating a directory or repository, inspect the target path, parent Git configuration, existing remotes, and existing resources to avoid overwriting files or reusing the wrong repository.
2. Gather approved visual references, real content, media provenance, target devices, domain, CMS, and hosting platform. Mark unknowns as unknown; do not invent them.
3. Deliver a locally runnable site and preview boundary first. Add lint, type checks, tests, target-runtime builds, and route smoke checks as appropriate.
4. Before adding admin features, define identity, data ownership, drafts, publishing, and recovery. Isolate originals, public derivatives, and backups.
5. Accept local behavior, browser behavior, cloud services, content publication, and backups separately. Perform production actions within the owner’s authorization and preserve a usable prior version.
6. Maintain phase records, deployment steps, fixes, and outstanding work alongside the code so another developer can reproduce the process.

## 7. Status and open items as of the record date

- The portfolio public Worker is running on the authorized separate subdomain; search indexing remains disabled. The existing domain and admin Worker are separate.
- Sanity/R2/D1, Access, the media processor, and the visual editor have real connection or acceptance records. Use dated entries in `PLANS.md` for each exact state and version.
- Public content and private drafts are different. The homepage layout overflow remains unresolved and its publication was deferred by the owner; do not move or publish it without a new request.
- The local PC processor does not automatically sync to NAS/OneDrive. A full website backup/restore drill is not claimed as complete.
- Cloudflare plans, CPU limits, storage quotas, billing, and deployed versions can change; verify them live before reuse.
- The private project's Git history available on September 28 shows staged development commits starting with a September 20 project snapshot. Earlier setup and September 19 work are supplemented by `PLANS.md`, design records, and local Codex session metadata. The public starter deliberately begins with a separate clean root commit. Neither history alone reconstructs every step.

## 8. Further reading in this repository

- Canva reference observations: [`DESIGN-REFERENCE.md`](https://github.com/ryanzhao/portfolio-website-starter/blob/main/docs/DESIGN-REFERENCE.md)
- Architecture boundaries: [`ARCHITECTURE.md`](https://github.com/ryanzhao/portfolio-website-starter/blob/main/docs/ARCHITECTURE.md)
- Verification record: [`VERIFICATION.md`](https://github.com/ryanzhao/portfolio-website-starter/blob/main/docs/VERIFICATION.md)
