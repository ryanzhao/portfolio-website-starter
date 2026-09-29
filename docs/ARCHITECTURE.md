# Architecture decisions

## Implemented foundation

Next App Router Server Components render routes. Only filters and theme controls
use client components. Tailwind v4 is installed through PostCSS; shared CSS tokens
define typography, spacing, width, surface, borders and controls. System fonts
avoid external font services. No invented engineering images or results.

OpenNext emits `.open-next/worker.js` and assets for Workers. Node compatibility
is enabled. Phase 1 request rendering deliberately avoids persistence claims about
ISR, CMS webhooks, caches or multi-region invalidation. All pages are draft-only,
noindex and local. A public preview will require authentication before upload.

## Subsequent integrations

Sanity Content Lake hosts content; embedded Studio is only the editing UI.
R2 provides three isolated spaces: private originals, public processed variants,
private backups. Stable IDs/keys belong in CMS, never signed URLs or credentials.
D1 stores idempotent operational jobs, lease expiry, retries and per-target status.
NAS pulls outbound, processes media and verifies backups; it is never the origin.
OneDrive is a second independent copy, subject to account/tenant/quota constraints.

An immutable release manifest links code revision, Worker deployment, content
snapshot, schema/migration versions and media checksums. Cross-service publication
is a reconciled workflow, not an atomic transaction. Failed publication retains
the previous usable release. These mechanisms are not implemented in Phase 1.

## Official references checked

- https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- https://opennext.js.org/cloudflare
- https://opennext.js.org/cloudflare/get-started

Compatibility was cross-checked against npm package peer dependencies. Installed
versions are recorded in package-lock.json; Sanity 6.15.0 is a Phase 2 candidate,
not a validated integration. Recheck before adding it.
