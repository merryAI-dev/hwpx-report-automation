# Commercialization Readiness Review

Date: 2026-03-09
Branch baseline: `feat/hwpx-editor-improvements`

## What is now true

- Core auth, tenant switching, external blob storage, batch generation, HWP intake, async jobs, quality gates, and pilot telemetry are merged on the main product branch.
- Local regression baseline is green: `tsc --noEmit`, `npm test`, and browser smoke on `/batch` and `/pilot`.
- Commercially sensitive API contracts now have direct route coverage for:
  - `POST /api/batch-generate`
  - `POST /api/blob/upload`
  - `GET /api/blob/download/[blobId]`
  - production `AUTH_SECRET` enforcement

## CPO view: readiness by area

### 1. Product value

Strong enough for guided pilots:

- authenticated editor access
- tenant-aware session model
- batch HWPX generation
- signed blob downloads
- pilot metrics dashboard

Still weak for broad commercial packaging:

- no durable customer-facing document workspace model is exposed yet
- no billing / quota / entitlement model exists
- no customer onboarding flow exists for tenant bootstrap, provider setup, or template lifecycle

### 2. Release robustness

Improved:

- blob auth and signed download contracts are covered
- batch generation contract is covered
- production secret requirement is covered

Still missing:

- no CI-enforced browser e2e suite
- no deployment health gate tied to preview or production
- Hancom/DVC validation remains optional, not release-blocking

### 3. Operational readiness

Current blockers:

- GitHub deployment environments are not configured
- this repo is not linked to a Vercel project
- the existing Vercel `web` project is a different application (`Noxion Demo`)
- there is no staging URL tied to this repository today

Impact:

- no true preview smoke on deployed infrastructure
- no environment-specific approval path
- no release evidence chain from commit to deployment

### 4. Enterprise trust

Good direction:

- tenant-aware auth model exists
- signed blob access exists

Still required before external commercial launch:

- persistent document ACL model
- audit trail for document reads/downloads
- key rotation / secret rotation playbook
- customer-visible SLA, incident flow, and retention policy

## Priority gaps before commercialization

### P0

- establish a real preview/staging deployment linked to this repo
- add CI browser smoke against deployed preview
- make Hancom/DVC validation a release gate for HWPX-critical changes

### P1

- add persistent document ownership / sharing / ACL rules
- add batch job durability beyond in-memory execution
- add alerting and release health checks for auth, batch, and blob APIs

### P2

- add template catalog management UX
- add admin controls for tenant/provider bootstrap
- add quota and usage reporting

## Recommendation

Do not frame the product as production-ready SaaS yet.

The right statement today is:

`pilot-ready with strong local regression coverage, but not yet deployment-governed or enterprise-hardened`

## Immediate next build items

1. Create a dedicated Vercel preview project for this repo and sync minimum runtime env vars.
2. Add browser e2e in CI for `login -> batch -> pilot`.
3. Add release-blocking compatibility validation for HWPX export paths.
