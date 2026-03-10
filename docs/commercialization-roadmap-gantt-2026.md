# HWPX Commercialization Roadmap Gantt

Date: 2026-03-07
Range: 2026-03-09 to 2026-08-28
Target product: `hwpx-report-automation/web`

## Goals

- End of April 2026: Internal Alpha
- Early June 2026: Pilot Beta
- End of August 2026: Commercial GA

The target is not a generic Hangul editor. The target is a commercialization path centered on `HWPX compatibility assurance + AI-assisted automation + template/batch operations`.

## Gantt

```mermaid
gantt
    title HWPX Commercialization Roadmap (2026-03-09 to 2026-08-28)
    dateFormat  YYYY-MM-DD
    axisFormat  %m/%d
    excludes    weekends

    section Baseline
    Product scope and KPI lock                :done, p0, 2026-03-09, 2026-03-13
    Supported feature matrix                  :active, p1, 2026-03-09, 2026-03-20
    Regression corpus definition              :p2, 2026-03-10, 2026-03-21

    section Compatibility and Validation
    HWPX coverage matrix                      :c1, 2026-03-16, 2026-04-03
    DVC-backed validation pipeline            :c2, after c1, 2026-04-06, 2026-04-24
    Hancom round-trip regression harness      :c3, 2026-04-06, 2026-05-01
    Render diff and corruption reporting      :c4, 2026-04-20, 2026-05-15
    Complex object support expansion          :c5, 2026-05-04, 2026-06-12

    section Security and Platform
    Remove auth bypass, enable access gates   :s1, 2026-03-16, 2026-03-27
    ACL and audit hardening                   :s2, after s1, 2026-03-30, 2026-04-17
    External blob storage split               :s3, 2026-04-06, 2026-04-24
    Tenant and environment isolation          :s4, 2026-04-27, 2026-05-22
    SSO/OIDC and admin console                :s5, 2026-05-25, 2026-06-19

    section Templates and Batch
    Metatag-based template schema             :t1, 2026-03-23, 2026-04-17
    Template catalog and versioning           :t2, after t1, 2026-04-20, 2026-05-15
    Async job queue and retry model           :t3, 2026-04-20, 2026-05-22
    Batch operations UI                       :t4, after t3, 2026-05-25, 2026-06-12
    HWP to HWPX conversion PoC                :t5, 2026-06-01, 2026-06-26

    section AI Quality Gate
    Numeric and named-entity guardrails       :a1, 2026-04-06, 2026-04-24
    Document-type prompt and rule packs       :a2, 2026-04-20, 2026-05-15
    Approval workflow and diff review         :a3, 2026-05-11, 2026-06-05
    Cost, model policy, and usage metrics     :a4, 2026-05-18, 2026-06-12

    section Pilot and Launch
    Internal Alpha                            :milestone, m1, 2026-04-24, 1d
    Pilot Beta                                :milestone, m2, 2026-06-05, 1d
    Pilot onboarding for 2-3 customers        :l1, 2026-06-08, 2026-07-03
    Security, performance, runbook hardening  :l2, 2026-06-15, 2026-07-17
    Pricing, packaging, operations docs       :l3, 2026-07-06, 2026-07-24
    GA candidate                              :milestone, m3, 2026-07-31, 1d
    UAT and release approval                  :l4, 2026-08-03, 2026-08-21
    Commercial GA                             :milestone, m4, 2026-08-28, 1d
```

## Critical Path

1. Compatibility validation engine
2. Removal of authentication bypass
3. Async batch pipeline
4. Template schema and metatag convention
5. Pilot customer corpus acquisition
