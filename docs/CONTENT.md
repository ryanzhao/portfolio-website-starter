# Content and trust

Current `src/lib/projects.ts` has only the three explicitly allowed draft subjects.
No confirmed status, role, dates, metrics, contact or educational history exists.
Draft previews are visible only on the local preview and excluded from indexing.

Phase 2 models: siteSettings, project, update, about, mediaAsset, contentSnapshot /
releaseManifest. Multilingual fields should retain locale identity while the initial
frontend is English and admin Chinese. Operational heartbeats belong outside CMS.

Publication must validate required fields and references, ensure media ready,
preserve slug redirects, and label metrics measured/simulated/target.
No update entries are fabricated; unknown update/project slugs return 404.
