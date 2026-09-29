# Verification record

## Visual admin library (2026-09-20)

- Final 65/65 tests, zero skipped with FFmpeg/FFprobe; lint/typecheck, OpenNext
  build and Workers smoke (14 pages + anonymous library GET/POST denial) passed.
  Sandbox esbuild parent-directory denial and silent ESLint nonzero resolved by
  rerunning local verification outside the sandbox, without changing business logic.
- Red/green tests cover pending/error isolation, ownership, published fallback and
  identical retained drafts. Real local D1 covers tag CAS, owner isolation, full-set
  filtering, literal search and pagination. Source/render checks supplement, not replace UI QA.
- Deployment ee14c53c-1aa7-4a53-9861-ff1bf00e59b6; only additive D1 migration0008.
- Actual authenticated Chrome: existing synthetic video's tags persisted on reload,
  duplicates removed, tag filtering worked; selected same original into existing
  project.2 and saved without changing alt/caption, then reloaded. Private videos
  decode320x240/error=null; no extra publication or uploaded test assets.
- Final five widths390/768/1024/1440/1920: body scrollWidth=clientWidth and library
  scrollWidth=clientWidth. Desktop side/mobile bottom panel screenshots inspected.
  Escape focus restoration, default-off publication and image-only compatibility
  checked. Captured browser errors empty. Viewport override reset.
- Existing real homepage original/draft remains waiting for PC processing, untouched.
  This does not claim new-interface real-file upload, root-domain rollout or full-site restoration.

## Backend foundations (2026-09-19, in progress)

- Studio integration follow-up: full ESLint, 7 Node checks, typecheck and final
  OpenNext production build passed. Six schema types compile with Sanity's compiler.
  Dependency audit is 0 after scoped transitive patches; no forced Sanity downgrade.
- Admin overview checked at 390/1440 with no overflow; editor link reaches the
  explicit unconfigured state. Initial browser CSP font errors prompted lazy loading
  only after server authorization. Real configured Studio/login remains untested.
- Build recovery: Node reported a OneDrive cloud-reparse directory as a symlink,
  causing Next unlink EPERM. Old generated `.next` was preserved (not deleted) in
  ignored `output/build-recovery/next-before-studio-20260919`; clean rebuild passed.
  Source/media files were not moved. Generated recovery output excluded from checks.

- Shared Access JWT verifier rejects invalid signatures/claims, non-admin identities
  and cross-origin writes in local ephemeral-key tests; real Access remains unconnected.
- Added upload-declaration and placement validators; 4 Node tests pass. These do
  not inspect media bytes or establish an upload/publish end-to-end result.
- Changed-file ESLint, TypeScript and final Next/OpenNext build passed.
- Local Workers smoke passes: 13 pages, 4 real 404s, 24 rendered placement IDs
  exactly match the admin catalog; anonymous session/catalog requests fail closed
  and carry no-store. No real Sanity/R2/Access resources were created or connected.
- Node tests emit a TypeScript ESM detection warning; no test failures.
- Full backend goal remains incomplete: CMS, upload transfer/persistence, private
  preview and publication still need implementation and end-to-end verification.

## Approved Canva design iteration (2026-09-19)

- Implemented homepage plus five `/work/[slug]` section designs; real images are
  intentionally absent. No CMS/upload/backend work was added in this iteration.
- Final lint, typecheck, preview-isolation unit check, production Next build and
  OpenNext build passed.
- Final workerd HTTP smoke: 12 routes return 200, four unknown routes return 404,
  noindex headers and no-store health pass.
- Final Chromium: all six design pages checked at 390, 768, 1024, 1440 and 1920px.
  30 screenshots, zero horizontal overflow. Fixed 768px photo/card overflow by
  constraining placeholder width and using two card columns at tablet sizes.
- Mobile navigation open/close, Escape focus return, category anchor navigation,
  keyboard skip-link focus all passed. Production console: 0 errors, 0 warnings.
- Screenshots under ignored output/playwright/final-*.png. Home mobile/desktop and
  representative section images were visually inspected. This is browser viewport
  testing, not physical iOS/Safari/Android hardware certification.
- Local production Workers preview left running at http://127.0.0.1:8787/.
  Development preview was stopped. No remote deployment.
- Dark OS preference preserves the reference's intentional black/light composition;
  this design no longer presents a global recoloring theme switch.
- Pixel-identical fidelity is not claimed: images/graphic logo await the owner,
  Georgia substitutes for the unidentified Canva font, mobile diagram connectors
  are simplified. Image crop/contrast acceptance must be repeated after real assets.

The earlier record below is historical and does not supersede these final checks.

This file is updated with actual commands/results after execution.
Current task scope: Phase 0 + Phase 1 local preview.

Executed 2026-09-19:

- Dependency installation and lockfile generated. Audit: 0 vulnerabilities after
  overriding rclone.js's vulnerable adm-zip dependency to 0.6.1. This is a build-tool
  dependency; no R2 rclone upload or backup behavior has been tested.
- ESLint: passed with no warnings after PostCSS export cleanup.
- TypeScript route generation/typecheck: passed. Preview configuration unit check: 1 passed.
- Next 16.3.5 production build and OpenNext 1.20.6 build: passed on Windows.
- Wrangler 4.135.0 local workerd smoke: 7 routes 200, 3 unknown routes 404,
  noindex headers and no-store dynamic health: passed after removing the streaming
  loading boundary which had caused soft-404 responses.
- Browser screenshots captured for home/project/admin at 390/768/1024/1440/1920.
  Representative screenshots visually inspected. Screenshot files are ignored under
  output/playwright. Final overflow assertion report still pending.
- Browser category, tag and empty-state filtering and theme switching executed.
  Keyboard skip target needed tabIndex=-1; this latest change and heading correction
  have NOT yet been rebuilt/retested because visual work was paused for Canva approval.
- Whole-directory secret scan included generated dependencies and returned nonzero;
  staged/source-only secret scan and website commit remain pending. No website commit,
  remote, push, public deployment or release tag exists.

Local preview server stopped for rebuild; not currently promised running.
No formal accessibility certification or performance score is claimed.

Conversation archive: source D:/CodexData verified, existing scheduled task reused.
Validated existing staged managed exports against manifest hashes, scanned with
Gitleaks and verified GitHub destination private; preserved them in local commit
66aacd5. Sync still blocked: origin/main has separate commit 1653057 adding a course
review file, so the script's ff-only merge rejects divergent history. No force push
or deletion performed. Task returned 1; automatic archive synchronization is NOT
verified healthy. Preserve both histories when resolving in subsequent work.

Not run and not represented as complete: cloud publication, Sanity edits, R2 upload,
multipart transfer, 60-second publication latency, NAS/OneDrive verification,
restoration drill, CI deployment or domain migration, Lighthouse/Core Web Vitals.
# Private stored-upload inspection — 2026-09-19

- Added `file-type` 22.1.1 for signature recognition, capped at 64 KiB; size must
  match the stored object. A successful signature check is only processing_pending.
- Added conditional private R2 HEAD/range inspection with immutable UUID key
  validation, ETag and version checks; does not modify/delete originals.
- `npm test`: 9 tests passed, including local Miniflare R2 reads, missing/invalid
  objects, bounded prefix reads, and replacements during inspection. Test-first
  failures for missing functions were observed before implementation.
- Existing Node module-type warnings remain. No cloud bindings/resources created;
  upload endpoints, codec processing, preview and publication remain incomplete.
- Miniflare 5 needs its exported `convertV4MiniflareOptions` adapter for the older
  options syntax. Its proxy's `in` operator reads a property, so probing `body`
  transfers the stream; the inspection tests capability via `arrayBuffer` instead.
# Upload-session persistence — 2026-09-19

- New additive D1 migration tested in an isolated local database only.
- Local R2 multipart creation/retry/cancellation and D1 atomic quota reservation
  pass, including concurrent identical requests and competing quota requests.
- Unauthorized owners receive not-found; changed metadata and expired/ended
  sessions are rejected. Cancellation remains possible for expired uploads.
- `npm test`: 10 passed. Typecheck passed. Existing module-type warnings remain.
- No remote resources or migration, browser upload, upload-completion API, preview
  publication or cloud end-to-end success is implied by these tests.
# Multipart completion — 2026-09-19

- Local D1/R2 completion tests now cover manifest validation/locking, real multipart
  assembly, stored signature verification, repeated completion, retained rejected
  originals, cancellation after an invalid receipt, and recovery when R2 committed
  before D1 recorded inspection. Completed originals are never deleted by cancel.
- Full test suite: 11 passed. Typecheck and lint passed. Node module-type warnings
  remain. Latest helper changes have not yet undergone a new OpenNext build.
- No browser direct upload or processing-ready/publication claim; those are pending.
- Cloudflare dashboard currently shows login. No authenticated resource inventory
  was available and no Cloudflare settings were changed.
