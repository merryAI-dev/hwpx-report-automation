import type { TemplateFieldDefinition, TemplateCatalog } from "@/lib/template-catalog";

export type TemplateFieldDiffEntry = {
  key: string;
  status: "added" | "removed" | "changed";
  oldField: TemplateFieldDefinition | null;
  newField: TemplateFieldDefinition | null;
  changedProps: string[];
};

export type TemplateCatalogDiff = {
  fromVersionId: string;
  toVersionId: string;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  entries: TemplateFieldDiffEntry[];
};

export function diffTemplateCatalogs(
  fromVersionId: string,
  oldCatalog: TemplateCatalog,
  toVersionId: string,
  newCatalog: TemplateCatalog,
): TemplateCatalogDiff {
  const oldByKey = new Map<string, TemplateFieldDefinition>(
    oldCatalog.fields.map((field) => [field.key, field]),
  );
  const newByKey = new Map<string, TemplateFieldDefinition>(
    newCatalog.fields.map((field) => [field.key, field]),
  );

  const entries: TemplateFieldDiffEntry[] = [];

  // Removed fields: in old but not in new
  for (const [key, oldField] of oldByKey) {
    if (!newByKey.has(key)) {
      entries.push({
        key,
        status: "removed",
        oldField,
        newField: null,
        changedProps: [],
      });
    }
  }

  // Added fields: in new but not in old
  for (const [key, newField] of newByKey) {
    if (!oldByKey.has(key)) {
      entries.push({
        key,
        status: "added",
        oldField: null,
        newField,
        changedProps: [],
      });
    }
  }

  // Changed fields: in both
  for (const [key, oldField] of oldByKey) {
    const newField = newByKey.get(key);
    if (!newField) {
      continue;
    }
    const changedProps: string[] = [];
    if (oldField.type !== newField.type) {
      changedProps.push("type");
    }
    if (oldField.label !== newField.label) {
      changedProps.push("label");
    }
    if (oldField.required !== newField.required) {
      changedProps.push("required");
    }
    if (oldField.defaultValue !== newField.defaultValue) {
      changedProps.push("defaultValue");
    }
    if (JSON.stringify(oldField.options) !== JSON.stringify(newField.options)) {
      changedProps.push("options");
    }
    if (oldField.description !== newField.description) {
      changedProps.push("description");
    }
    if (changedProps.length > 0) {
      entries.push({
        key,
        status: "changed",
        oldField,
        newField,
        changedProps,
      });
    }
  }

  // Sort entries by key for deterministic output
  entries.sort((a, b) => a.key.localeCompare(b.key));

  const addedCount = entries.filter((e) => e.status === "added").length;
  const removedCount = entries.filter((e) => e.status === "removed").length;
  const changedCount = entries.filter((e) => e.status === "changed").length;

  return {
    fromVersionId,
    toVersionId,
    addedCount,
    removedCount,
    changedCount,
    entries,
  };
}
