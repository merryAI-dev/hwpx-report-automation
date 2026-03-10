import { describe, expect, it } from "vitest";
import { diffTemplateCatalogs } from "./template-diff";
import type { TemplateCatalog, TemplateFieldDefinition } from "@/lib/template-catalog";

function makeField(key: string, overrides: Partial<TemplateFieldDefinition> = {}): TemplateFieldDefinition {
  return {
    key,
    originalKey: key,
    type: "text",
    label: key,
    required: false,
    defaultValue: null,
    description: null,
    options: [],
    occurrences: [],
    ...overrides,
  };
}

function makeCatalog(fields: TemplateFieldDefinition[]): TemplateCatalog {
  return {
    version: `tpl-${fields.map((f) => f.key).join("-")}`,
    fieldCount: fields.length,
    rawTagCount: fields.length,
    fields,
    issues: [],
  };
}

describe("diffTemplateCatalogs", () => {
  it("returns empty diff when catalogs are identical", () => {
    const fields = [makeField("name"), makeField("date")];
    const old = makeCatalog(fields);
    const next = makeCatalog(fields);
    const result = diffTemplateCatalogs("v1", old, "v2", next);
    expect(result.addedCount).toBe(0);
    expect(result.removedCount).toBe(0);
    expect(result.changedCount).toBe(0);
    expect(result.entries).toHaveLength(0);
  });

  it("detects added fields", () => {
    const old = makeCatalog([makeField("name")]);
    const next = makeCatalog([makeField("name"), makeField("email")]);
    const result = diffTemplateCatalogs("v1", old, "v2", next);
    expect(result.addedCount).toBe(1);
    expect(result.removedCount).toBe(0);
    expect(result.changedCount).toBe(0);
    const added = result.entries.find((e) => e.key === "email");
    expect(added).toBeDefined();
    expect(added?.status).toBe("added");
    expect(added?.oldField).toBeNull();
    expect(added?.newField?.key).toBe("email");
  });

  it("detects removed fields", () => {
    const old = makeCatalog([makeField("name"), makeField("phone")]);
    const next = makeCatalog([makeField("name")]);
    const result = diffTemplateCatalogs("v1", old, "v2", next);
    expect(result.removedCount).toBe(1);
    const removed = result.entries.find((e) => e.key === "phone");
    expect(removed?.status).toBe("removed");
    expect(removed?.newField).toBeNull();
    expect(removed?.oldField?.key).toBe("phone");
  });

  it("detects changed type", () => {
    const old = makeCatalog([makeField("amount", { type: "text" })]);
    const next = makeCatalog([makeField("amount", { type: "number" })]);
    const result = diffTemplateCatalogs("v1", old, "v2", next);
    expect(result.changedCount).toBe(1);
    const changed = result.entries[0];
    expect(changed.status).toBe("changed");
    expect(changed.changedProps).toContain("type");
  });

  it("detects changed label", () => {
    const old = makeCatalog([makeField("name", { label: "Name" })]);
    const next = makeCatalog([makeField("name", { label: "Full Name" })]);
    const result = diffTemplateCatalogs("v1", old, "v2", next);
    expect(result.changedCount).toBe(1);
    expect(result.entries[0].changedProps).toContain("label");
  });

  it("detects changed required", () => {
    const old = makeCatalog([makeField("email", { required: false })]);
    const next = makeCatalog([makeField("email", { required: true })]);
    const result = diffTemplateCatalogs("v1", old, "v2", next);
    expect(result.changedCount).toBe(1);
    expect(result.entries[0].changedProps).toContain("required");
  });

  it("detects changed defaultValue", () => {
    const old = makeCatalog([makeField("status", { defaultValue: null })]);
    const next = makeCatalog([makeField("status", { defaultValue: "active" })]);
    const result = diffTemplateCatalogs("v1", old, "v2", next);
    expect(result.changedCount).toBe(1);
    expect(result.entries[0].changedProps).toContain("defaultValue");
  });

  it("detects changed options", () => {
    const old = makeCatalog([makeField("choice", { options: ["A", "B"] })]);
    const next = makeCatalog([makeField("choice", { options: ["A", "B", "C"] })]);
    const result = diffTemplateCatalogs("v1", old, "v2", next);
    expect(result.changedCount).toBe(1);
    expect(result.entries[0].changedProps).toContain("options");
  });

  it("detects changed description", () => {
    const old = makeCatalog([makeField("note", { description: null })]);
    const next = makeCatalog([makeField("note", { description: "Some note" })]);
    const result = diffTemplateCatalogs("v1", old, "v2", next);
    expect(result.changedCount).toBe(1);
    expect(result.entries[0].changedProps).toContain("description");
  });

  it("correctly sets fromVersionId and toVersionId", () => {
    const old = makeCatalog([makeField("x")]);
    const next = makeCatalog([makeField("y")]);
    const result = diffTemplateCatalogs("from-abc", old, "to-xyz", next);
    expect(result.fromVersionId).toBe("from-abc");
    expect(result.toVersionId).toBe("to-xyz");
  });

  it("handles multiple mixed changes", () => {
    const old = makeCatalog([makeField("a"), makeField("b"), makeField("c")]);
    const next = makeCatalog([makeField("a", { type: "number" }), makeField("d")]);
    // a: changed, b: removed, c: removed, d: added
    const result = diffTemplateCatalogs("v1", old, "v2", next);
    expect(result.addedCount).toBe(1);
    expect(result.removedCount).toBe(2);
    expect(result.changedCount).toBe(1);
    expect(result.entries).toHaveLength(4);
  });

  it("does not produce changed entry when values are the same", () => {
    const field = makeField("code", { type: "text", label: "Code", required: true, defaultValue: "N/A", options: ["A", "B"] });
    const old = makeCatalog([field]);
    const next = makeCatalog([{ ...field }]);
    const result = diffTemplateCatalogs("v1", old, "v2", next);
    expect(result.changedCount).toBe(0);
    expect(result.entries).toHaveLength(0);
  });
});
