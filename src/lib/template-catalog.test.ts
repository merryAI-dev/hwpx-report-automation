import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  buildTemplateCatalogFromDoc,
  parseTemplateTag,
  validateTemplateFieldValues,
} from "./template-catalog";

function buildDoc(content: JSONContent[]): JSONContent {
  return {
    type: "doc",
    content,
  };
}

describe("template catalog", () => {
  it("parses typed metatags with attributes", () => {
    const parsed = parseTemplateTag("{{date:report_date|required|label=보고일|default=2026-03-07}}");
    expect(parsed).toBeTruthy();
    expect(parsed?.key).toBe("report_date");
    expect(parsed?.type).toBe("date");
    expect(parsed?.required).toBe(true);
    expect(parsed?.label).toBe("보고일");
    expect(parsed?.defaultValue).toBe("2026-03-07");
    expect(parsed?.issues).toEqual([]);
  });

  it("builds a stable catalog from repeated placeholders", () => {
    const doc = buildDoc([
      {
        type: "paragraph",
        attrs: { segmentId: "seg-1", fileName: "Contents/section0.xml", textIndex: 0 },
        content: [{ type: "text", text: "제목 {{TITLE}} / 날짜 {{date:report_date|required|label=보고일}}" }],
      },
      {
        type: "paragraph",
        attrs: { segmentId: "seg-2", fileName: "Contents/section0.xml", textIndex: 1 },
        content: [{ type: "text", text: "회사 {{TITLE}} 재사용" }],
      },
    ]);

    const catalog = buildTemplateCatalogFromDoc(doc);
    expect(catalog.fieldCount).toBe(2);
    expect(catalog.rawTagCount).toBe(3);
    expect(catalog.fields.map((field) => field.key)).toEqual(["report_date", "title"]);
    expect(catalog.fields[1].occurrences).toHaveLength(2);
    expect(catalog.version).toMatch(/^tpl-[0-9a-f]{8}$/);
  });

  it("reports conflicting definitions for the same field key", () => {
    const doc = buildDoc([
      {
        type: "paragraph",
        attrs: { segmentId: "seg-1", fileName: "Contents/section0.xml", textIndex: 0 },
        content: [{ type: "text", text: "{{choice:status|options=draft,final}}" }],
      },
      {
        type: "paragraph",
        attrs: { segmentId: "seg-2", fileName: "Contents/section0.xml", textIndex: 1 },
        content: [{ type: "text", text: "{{text:status|required|label=상태}}" }],
      },
    ]);

    const catalog = buildTemplateCatalogFromDoc(doc);
    expect(catalog.fieldCount).toBe(1);
    expect(catalog.issues.some((issue) => issue.code === "conflicting_type")).toBe(true);
    expect(catalog.issues.some((issue) => issue.code === "conflicting_label")).toBe(true);
  });

  it("validates required and choice values against the catalog", () => {
    const doc = buildDoc([
      {
        type: "paragraph",
        attrs: { segmentId: "seg-1", fileName: "Contents/section0.xml", textIndex: 0 },
        content: [{ type: "text", text: "{{choice:status|required|options=draft,final}} / {{TITLE}}" }],
      },
    ]);

    const catalog = buildTemplateCatalogFromDoc(doc);
    const issues = validateTemplateFieldValues(catalog, {
      title: "주간 보고서",
      status: "archived",
      unused_field: "ignored",
    });

    expect(issues).toEqual([
      {
        code: "invalid_choice",
        severity: "error",
        fieldKey: "status",
        message: '필드 "Status"(status) 값 archived 이(가) 허용된 옵션에 없습니다.',
      },
      {
        code: "unknown_field",
        severity: "warning",
        fieldKey: "unused_field",
        message: '카탈로그에 없는 필드 "unused_field" 값이 전달되었습니다.',
      },
    ]);
  });
});
