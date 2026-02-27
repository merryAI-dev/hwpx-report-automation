# Phase 6 Checkpoint: HWPX Image Support

## Context
- Phase 5 branch (`pr/phase5-hancom-fidelity`) is stable and has an open PR (#6).
- Image insertion/rendering in Hancom HWPX is still not implemented end-to-end.

## Verified Current State
- Editor side can surface image-related intent, but HWPX export does not generate real image objects.
- Export compatibility warnings currently mark unsupported image nodes.
- Local sample fixtures in this repo do not contain `hp:pic` / `BinData` examples, so implementation needs explicit schema-based construction.

## Phase 6 Immediate Goals
1. Add editor image node + insertion flow that survives save/load state.
2. Implement HWPX image embedding pipeline:
   - `BinData/*` payload write
   - manifest/content references update
   - section XML object insertion (`hp:pic`-based control)
3. Validate round-trip with generated HWPX opened in Hancom Office.

## Split Strategy
- This commit is a branch split checkpoint before Phase 6 implementation starts.
- Subsequent commits in the new branch focus only on image support and Hancom visibility.
