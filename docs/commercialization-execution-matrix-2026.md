# HWPX Commercialization Execution Matrix

Date: 2026-03-07
Scope: from roadmap to actionable GitHub work items
Repository: `merryAI-dev/hwpx-report-automation`

## Why This File Exists

This document converts the commercialization roadmap into:

- execution owners
- engineering priority
- rough effort
- suggested GitHub issues
- suggested implementation PR slices

The practical approach is:

1. Open one planning PR with the roadmap and this matrix.
2. Open multiple GitHub issues by workstream.
3. Implement the work in several focused PRs, not one large branch.

## Team Assumption

| Role | Responsibility |
| --- | --- |
| PM/Product | scope, KPI, pilot customer, rollout |
| FE | editor UX, review UX, dashboard, batch UI |
| Platform/BE | auth, storage, job queue, APIs |
| Document Engine | HWPX parser, export, validation, conversion |
| QA/Ops | regression corpus, Hancom verification, runbook |

## Priority Legend

- `P0`: blocks pilot or makes production unsafe
- `P1`: needed for beta or for reliable operations
- `P2`: important but can follow after beta

## Effort Legend

- `S`: <= 1 engineer-week
- `M`: 2 to 3 engineer-weeks
- `L`: 4 to 6 engineer-weeks
- `XL`: 7+ engineer-weeks or cross-team effort

## Proposed GitHub Issues

| ID | Suggested title | Owner | Priority | Effort | Target window | Why it exists |
| --- | --- | --- | --- | --- | --- | --- |
| COM-01 | Define HWPX compatibility coverage matrix and unsupported policy | Document Engine | P0 | M | Mar W2-W4 | Current export still warns on unsupported nodes/marks and lacks a product-level support contract. |
| COM-02 | Add DVC-backed HWPX structural validation to export pipeline | Document Engine | P0 | M | Mar W4-Apr W4 | Current integrity checks are necessary but not sufficient for standard-level verification. |
| COM-03 | Build Hancom round-trip regression harness for real fixture corpus | QA/Ops + Document Engine | P0 | L | Apr W1-May W1 | Current Hancom verification exists but is local/manual and not service-grade. |
| COM-04 | Remove auth bypass and introduce real document access control | Platform/BE | P0 | M | Mar W3-Apr W2 | `authorized()` currently allows all requests, which blocks commercialization. |
| COM-05 | Move HWPX binary blobs to external object storage with signed access | Platform/BE | P0 | M | Apr W1-Apr W4 | Prisma/SQLite blob storage is fine for local use, not for commercial-scale document retention. |
| COM-06 | Introduce tenant isolation and SSO-ready identity model | Platform/BE | P1 | L | Apr W4-Jun W1 | Needed for enterprise rollout and controlled access. |
| COM-07 | Add metatag-based template schema and template catalog versioning | PM/Product + Document Engine | P0 | L | Mar W4-May W2 | Batch flow is valuable but needs a stable template contract. |
| COM-08 | Add async batch job orchestration with retry, progress, and audit trail | Platform/BE | P0 | L | Apr W3-May W4 | Commercial usage will concentrate on high-volume generation, not only interactive editing. |
| COM-09 | Add AI quality gates for numbers, dates, named entities, and approval flow | PM/Product + FE + Platform/BE | P1 | L | Apr W2-Jun W1 | LLM output quality needs policy gates, not only free-form verification. |
| COM-10 | Build pilot launch dashboard, KPI tracking, and operations runbook | PM/Product + QA/Ops | P1 | M | Jun W2-Jul W3 | Needed to operate real pilots and measure adoption. |
| COM-11 | Expand complex object support beyond text/table/image happy paths | Document Engine | P1 | XL | May W1-Jun W2 | Commercial docs will include section settings, embedded objects, and layout-sensitive content. |
| COM-12 | Evaluate HWP to HWPX conversion intake path for enterprise migration | Document Engine | P2 | M | Jun W1-Jun W4 | Migration and legacy conversion can become a strong wedge feature. |

## Proposed Implementation PR Slices

These are the recommended implementation PR boundaries after the planning PR merges.

| PR slice | Scope | Related issues | Notes |
| --- | --- | --- | --- |
| PR-A | Compatibility matrix docs, unsupported policy, validation contract | COM-01 | Small docs + type-level contract changes. |
| PR-B | DVC validation integration and export gate | COM-02 | Keep separate from UI work; this is engine-critical. |
| PR-C | Auth bypass removal, ACL skeleton, audit hardening | COM-04 | Must land before external pilot access. |
| PR-D | Blob storage migration and signed file access | COM-05 | Isolate storage migration risk. |
| PR-E | Template schema, metatag extraction, template catalog foundation | COM-07 | Product-facing but engine-heavy. |
| PR-F | Async batch queue, retry, progress APIs, operations UI | COM-08 | Larger cross-cutting PR; may need 2 sub-PRs. |
| PR-G | AI quality rules, approval workflow, diff gate | COM-09 | Should follow after ACL and audit are in place. |
| PR-H | Pilot dashboard, KPI instrumentation, runbook docs | COM-10 | Close to beta readiness. |

## Issue Details

### COM-01

- Title: `Define HWPX compatibility coverage matrix and unsupported policy`
- Owner: Document Engine
- Priority: `P0`
- Effort: `M`
- Definition of done:
  - support matrix documented by object type
  - unsupported export behavior declared explicitly
  - editor/export warnings mapped to the support matrix

### COM-02

- Title: `Add DVC-backed HWPX structural validation to export pipeline`
- Owner: Document Engine
- Priority: `P0`
- Effort: `M`
- Definition of done:
  - exported files pass DVC checks in CI or release validation
  - validation results are surfaced in logs or API responses
  - broken exports fail closed, not silently

### COM-03

- Title: `Build Hancom round-trip regression harness for real fixture corpus`
- Owner: QA/Ops + Document Engine
- Priority: `P0`
- Effort: `L`
- Definition of done:
  - real fixture corpus is versioned
  - round-trip checks cover open, save, and visual confirmation path
  - regression runbook exists for failed fixtures

### COM-04

- Title: `Remove auth bypass and introduce real document access control`
- Owner: Platform/BE
- Priority: `P0`
- Effort: `M`
- Definition of done:
  - `authorized()` no longer returns unconditional allow
  - document routes require authenticated access
  - access checks exist for read/write/delete operations

### COM-05

- Title: `Move HWPX binary blobs to external object storage with signed access`
- Owner: Platform/BE
- Priority: `P0`
- Effort: `M`
- Definition of done:
  - document content no longer relies on SQLite blob as the only source of truth
  - signed download or access flow exists
  - migration path for existing documents is documented

### COM-06

- Title: `Introduce tenant isolation and SSO-ready identity model`
- Owner: Platform/BE
- Priority: `P1`
- Effort: `L`
- Definition of done:
  - tenant-aware data model exists
  - user-to-tenant mapping is enforced
  - SSO/OIDC integration points are documented or implemented

### COM-07

- Title: `Add metatag-based template schema and template catalog versioning`
- Owner: PM/Product + Document Engine
- Priority: `P0`
- Effort: `L`
- Definition of done:
  - template schema is explicit and versioned
  - metatag or stable field extraction replaces fragile implicit mapping
  - template catalog supports revision history

### COM-08

- Title: `Add async batch job orchestration with retry, progress, and audit trail`
- Owner: Platform/BE
- Priority: `P0`
- Effort: `L`
- Definition of done:
  - jobs run asynchronously
  - retry and failure state are visible
  - users can inspect progress and audit history

### COM-09

- Title: `Add AI quality gates for numbers, dates, named entities, and approval flow`
- Owner: PM/Product + FE + Platform/BE
- Priority: `P1`
- Effort: `L`
- Definition of done:
  - numeric and entity-preservation checks exist
  - approval flow is part of the editing workflow
  - AI usage is observable by cost, model, and failure class

### COM-10

- Title: `Build pilot launch dashboard, KPI tracking, and operations runbook`
- Owner: PM/Product + QA/Ops
- Priority: `P1`
- Effort: `M`
- Definition of done:
  - pilot KPI dashboard exists
  - top operational incidents have runbooks
  - beta exit criteria are measurable

### COM-11

- Title: `Expand complex object support beyond text/table/image happy paths`
- Owner: Document Engine
- Priority: `P1`
- Effort: `XL`
- Definition of done:
  - support plan exists for section settings, additional objects, and layout-sensitive nodes
  - export compatibility warnings shrink against the target corpus
  - real-customer fixtures round-trip with fewer manual exceptions

### COM-12

- Title: `Evaluate HWP to HWPX conversion intake path for enterprise migration`
- Owner: Document Engine
- Priority: `P2`
- Effort: `M`
- Definition of done:
  - conversion path options are compared
  - feasibility and risk are documented
  - go/no-go recommendation is made

## Recommended GitHub Workflow

1. Merge the planning PR that adds this file and the roadmap gantt.
2. Create one issue per `COM-XX` item.
3. Link each implementation PR to one or two issues only.
4. Keep engine, platform, and UX changes in separate PRs unless a shared schema forces bundling.
5. Treat `COM-01`, `COM-02`, `COM-04`, `COM-05`, and `COM-08` as the commercial critical path.
