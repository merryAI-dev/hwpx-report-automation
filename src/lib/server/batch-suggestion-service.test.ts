import { describe, expect, it } from "vitest";
import { MAX_BATCH_ITEMS, normalizeBatchItems } from "./batch-suggestion-service";

describe("normalizeBatchItems", () => {
  it("trims ids/text and removes empty rows", () => {
    const items = normalizeBatchItems([
      { id: " a ", text: " hello ", planContext: " family " },
      { id: "", text: "missing-id" },
      { id: "b", text: "   " },
    ]);

    expect(items).toEqual([{
      id: "a",
      text: "hello",
      styleHints: {},
      prevText: undefined,
      nextText: undefined,
      planContext: "family",
    }]);
  });

  it("caps the payload at MAX_BATCH_ITEMS", () => {
    const items = normalizeBatchItems(
      Array.from({ length: MAX_BATCH_ITEMS + 5 }, (_, index) => ({ id: `id-${index}`, text: `text-${index}` })),
    );

    expect(items).toHaveLength(MAX_BATCH_ITEMS);
    expect(items.at(-1)?.id).toBe(`id-${MAX_BATCH_ITEMS - 1}`);
  });

  it("keeps normalized rows ready for downstream quality gates", () => {
    const items = normalizeBatchItems([{ id: "report-1", text: "2024. 4. 5. 총 68%입니다." }]);
    expect(items[0]).toMatchObject({ id: "report-1", text: "2024. 4. 5. 총 68%입니다." });
  });
});
