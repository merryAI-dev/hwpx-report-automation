# Report Family Automation Roadmap

Date: 2026-03-12
Scope: evolve `hwpx-report-automation/web` from an editor into a report-family automation product
Reference artifacts:

- source exemplar: `[MYSC] 해양수산 최종결과보고서_1216_vf.pdf`
- target submission report: `★최종★[MYSC] 2025년 해양수산 액셀러레이터 최종보고서_엠와이소셜컴퍼니.pdf`

## 1. What the MYSC sample pair means

This is not a plain conversion problem.

The source is a slide-style landscape PDF.
The target is a formal A4 submission report with cover pages, TOC, dense summary tables, and appendix-like evidence expectations.

So the product should not learn:

- how to copy one report into another

It should learn:

- how to extract the target family TOC
- how to map slides to that TOC
- how to mask non-slide document sources during generation
- how to generate the report narrative from slides under a stable prompt loop

That is a different product category.

## 2. Product direction change

The most important near-term benchmark is not numeric accuracy first.
It is:

1. `목차를 제대로 뽑는가`
2. `슬라이드를 보고 섹션을 채우는가`
3. `슬라이드가 아닌 문서 소스를 generation context에서 masking하는가`
4. `benchmark 실패를 prompt 강화와 reviewer feedback으로 되먹이는가`

Numeric correctness still matters, but it should not be the first organizing principle for this family.
The first organizing principle is `TOC-grounded, slide-grounded generation`.

## 3. RALPH loop for this product

Use RALPH as a `benchmark-driven retry loop`.

The loop is:

1. `Run`
   - ingest exemplar slides, target report, and allowed evidence packet
2. `Assess`
   - score the run on measurable benchmark metrics
3. `Learn`
   - inspect failed metrics and reviewer corrections
4. `Patch`
   - adjust prompt, masking policy, section mapping, renderer, and benchmark corpus
5. `Repeat`
   - rerun until the family clears the gate

This is equivalent in spirit to:

- parse/generate
- validate
- reflect
- adjust
- retry

but adapted for report-family generation rather than field extraction only.

## 4. Benchmark packet design

Every report family needs a benchmark packet.

One packet should contain:

- source slides
- target report PDF
- optional supporting documents
- allowed source list
- masked source list
- expected TOC
- expected section-slot outputs
- expected appendix/attachment mapping

Minimum startup rule:

- do not onboard a family with one packet
- begin with `3+ benchmark packets`

## 5. Core benchmark metrics

For this family, the primary benchmark should be:

- `toc_extraction_accuracy`
- `section_coverage`
- `slide_grounding_coverage`
- `document_masking_coverage`
- `masked_source_leakage_rate`
- `layout_similarity`
- `table_structure_accuracy`
- `prompt_iteration_win_rate`
- `reviewer_edit_rate`
- `critical_hallucination_rate`
- `manual_correction_minutes`

Interpretation:

- `toc_extraction_accuracy`
  - can the system recover the family-level table of contents from the target report
- `slide_grounding_coverage`
  - how much generated section content is truly grounded in slides
- `document_masking_coverage`
  - how well the system excludes masked non-slide sources from generation input
- `masked_source_leakage_rate`
  - how often masked document content still leaks into the output
- `prompt_iteration_win_rate`
  - after one reflection/adjust step, how often the benchmark score improves

## 6. Prompt strategy

The prompt strategy should be section-first, not whole-document-first.

Each section generation prompt should include:

- family name
- target TOC slot
- section purpose
- slide chunk summaries for this section only
- explicit forbidden source policy
- required output format for the section

Prompt rules:

- never allow masked documents in narrative generation context
- use masked documents only for evaluator comparisons or leakage detection
- slides are the primary narrative source
- target report is the structural source, not the content source

That last line is important:

- target report tells us `how to structure`
- slides tell us `what to write`

## 7. Reinforcement logic

This does not need RL in the narrow model-training sense first.
Product-wise, the right reinforcement logic is:

1. benchmark fails
2. find which metric failed
3. map failure to a retry bucket
4. store reviewer correction as gold evidence
5. rerun with updated prompt/schema/masking

Recommended retry buckets:

- `improve_toc_extractor`
- `tighten_document_masking`
- `strengthen_slide_grounding_prompt`
- `improve_layout_renderer`
- `promote_reviewer_feedback`
- `collect_benchmark_packets`

This logic is implemented in:

- `src/lib/report-template-benchmark.ts`
- `src/lib/report-template-ralph-loop.ts`

## 8. Product objects to add

The current editor needs additional first-class objects:

1. `ReportFamily`
   - accelerator final report, board report, weekly report, etc.
2. `BenchmarkPacket`
   - one family evaluation sample
3. `FamilySchemaVersion`
   - canonical TOC and section graph
4. `SourcePolicy`
   - allowed slides, masked docs, evaluation-only docs
5. `GenerationRun`
   - prompt, retrieval inputs, outputs, metrics
6. `ReviewerFeedback`
   - accepted corrections and retry hints

Without these objects, the system remains a flexible editor, not a learnable report factory.

## 9. Roadmap by phase

## Phase 0. Family bootstrap

Build:

- PDF/PPTX layout ingestion
- TOC extractor
- section graph builder
- benchmark packet registry

Exit criteria:

- 3 benchmark packets for one family
- target TOC extracted with useful accuracy

## Phase 1. Slide-grounded generation

Build:

- section-level slide chunk retrieval
- masked source policy
- slide-grounded prompt pack
- section-slot generation flow

Exit criteria:

- slide-grounding benchmark stable
- masked document leakage measurable

## Phase 2. Retry loop and feedback memory

Build:

- benchmark scorer
- retry bucket planner
- reviewer correction capture
- prompt memory / few-shot feedback store

Exit criteria:

- prompt iteration win rate improves across runs
- reviewer fixes become new benchmark golds

## Phase 3. Layout and submission hardening

Build:

- report blueprint renderer
- visual diff
- table fidelity checks
- appendix/attachment mapping

Exit criteria:

- generated report is submission-grade
- reviewer edit time drops materially

## Phase 4. Family factory

Build:

- multi-family registry
- family similarity search
- onboarding workflow
- regression dashboard

Exit criteria:

- 3+ report families onboarded
- each family has 3+ benchmark packets

## 10. What this means for MYSC right now

For the MYSC family, the next build step should be:

1. extract TOC from the target report
2. align slides to each TOC section
3. mark non-slide documents as masked generation sources
4. define the benchmark packet and gate
5. iterate prompt and retrieval until the family passes

That is the right starting PR direction.

## 11. Code added in this planning slice

Planning and evaluation primitives now live in:

- `src/lib/report-template-readiness.ts`
- `src/lib/report-template-benchmark.ts`
- `src/lib/report-template-ralph-loop.ts`

These are not the final product path themselves.
They are the scoring and retry skeleton that lets the product move toward a real RALPH loop.
