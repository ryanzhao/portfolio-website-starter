# Deployment

Local build: `npm run build:worker`. Local workerd: `npm run preview`.
All checks must run before a cloud release. Current Wrangler config disables
workers.dev and preview URLs and has no domain route or remote data bindings.

After approval, create/use a verified private GitHub repository and separate
preview/production resources. Set a single production trigger: protected GitHub
Actions main workflow, with pinned action SHAs and a concurrency lock. The workflow
must install the lockfile, lint/typecheck/test, build OpenNext, run workerd smoke,
deploy, check live routes and record a release manifest. No secrets to fork PRs.

No CI deployment workflow is active in Phase 1: first publication, destinations
and credentials are not authorized/configured. Public preview authentication,
Access JWT validation, cloud resource isolation and content approval are prerequisites.

Official setup: https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
Adapter: https://opennext.js.org/cloudflare/get-started
