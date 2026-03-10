import type { JSONContent } from "@tiptap/core";

export type TemplateFieldType =
  | "text"
  | "date"
  | "number"
  | "currency"
  | "choice"
  | "boolean"
  | "table";

export type TemplateCatalogIssue = {
  code:
    | "invalid_tag"
    | "invalid_type"
    | "unknown_attribute"
    | "conflicting_type"
    | "conflicting_label"
    | "conflicting_required"
    | "conflicting_options"
    | "conflicting_default";
  severity: "error" | "warning";
  message: string;
  token: string;
  fieldKey?: string;
  segmentId?: string | null;
  fileName?: string | null;
};

export type TemplateFieldOccurrence = {
  token: string;
  segmentId?: string | null;
  fileName?: string | null;
  textIndex?: number | null;
};

export type TemplateFieldDefinition = {
  key: string;
  originalKey: string;
  type: TemplateFieldType;
  label: string;
  required: boolean;
  defaultValue: string | null;
  description: string | null;
  options: string[];
  occurrences: TemplateFieldOccurrence[];
};

export type TemplateCatalog = {
  version: string;
  fieldCount: number;
  rawTagCount: number;
  fields: TemplateFieldDefinition[];
  issues: TemplateCatalogIssue[];
};

export type TemplateValueIssue = {
  code: "missing_required" | "invalid_choice" | "unknown_field";
  severity: "error" | "warning";
  fieldKey: string;
  message: string;
};

type TemplateNodeAttrs = {
  segmentId?: string | null;
  fileName?: string | null;
  textIndex?: number | null;
};

type ParsedTemplateTag = {
  key: string;
  originalKey: string;
  type: TemplateFieldType;
  label: string;
  required: boolean;
  defaultValue: string | null;
  description: string | null;
  options: string[];
  token: string;
  issues: TemplateCatalogIssue[];
};

const TEMPLATE_TAG_PATTERN = /\{\{([^{}]+)\}\}/g;
const KNOWN_TYPES = new Set<TemplateFieldType>([
  "text",
  "date",
  "number",
  "currency",
  "choice",
  "boolean",
  "table",
]);

function extractNodeText(node: JSONContent): string {
  if (node.type === "text") {
    return node.text || "";
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  if (!node.content?.length) {
    return "";
  }
  return node.content.map((child) => extractNodeText(child)).join("");
}

function walk(node: JSONContent, visitor: (node: JSONContent) => void): void {
  visitor(node);
  if (!node.content?.length) {
    return;
  }
  for (const child of node.content) {
    walk(child, visitor);
  }
}

function normalizeFieldKey(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function humanizeFieldKey(value: string): string {
  const normalized = value.replace(/[_-]+/g, " ").trim();
  if (!normalized) {
    return "Unnamed Field";
  }
  return normalized
    .split(/\s+/)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase())
    .join(" ");
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function normalizeBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  return null;
}

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseTemplateTag(token: string): ParsedTemplateTag | null {
  const match = token.match(/^\{\{([\s\S]+)\}\}$/);
  if (!match) {
    return null;
  }

  const body = match[1].trim();
  const issues: TemplateCatalogIssue[] = [];
  if (!body) {
    return {
      key: "",
      originalKey: "",
      type: "text",
      label: "",
      required: false,
      defaultValue: null,
      description: null,
      options: [],
      token,
      issues: [
        {
          code: "invalid_tag",
          severity: "error",
          message: "빈 템플릿 태그는 허용되지 않습니다.",
          token,
        },
      ],
    };
  }

  const parts = body.split("|").map((part) => part.trim()).filter(Boolean);
  const head = parts.shift() || "";

  let fieldType: TemplateFieldType = "text";
  let rawKey = head;
  const headTypeSeparator = head.indexOf(":");
  if (headTypeSeparator > 0) {
    const maybeType = head.slice(0, headTypeSeparator).trim().toLowerCase();
    const maybeKey = head.slice(headTypeSeparator + 1).trim();
    if (KNOWN_TYPES.has(maybeType as TemplateFieldType)) {
      fieldType = maybeType as TemplateFieldType;
      rawKey = maybeKey;
    }
  }

  let label = "";
  let required = false;
  let defaultValue: string | null = null;
  let description: string | null = null;
  let options: string[] = [];

  for (const attr of parts) {
    if (attr.toLowerCase() === "required") {
      required = true;
      continue;
    }
    if (attr.toLowerCase() === "optional") {
      required = false;
      continue;
    }

    const separator = attr.indexOf("=");
    if (separator === -1) {
      issues.push({
        code: "unknown_attribute",
        severity: "warning",
        message: `알 수 없는 템플릿 속성 \"${attr}\"는 무시됩니다.`,
        token,
      });
      continue;
    }

    const attrKey = attr.slice(0, separator).trim().toLowerCase();
    const attrValue = attr.slice(separator + 1).trim();
    if (attrKey === "label") {
      label = attrValue;
      continue;
    }
    if (attrKey === "default") {
      defaultValue = attrValue;
      continue;
    }
    if (attrKey === "description") {
      description = attrValue;
      continue;
    }
    if (attrKey === "options") {
      options = uniqueSorted(attrValue.split(","));
      continue;
    }
    if (attrKey === "required") {
      const parsed = normalizeBoolean(attrValue);
      if (parsed === null) {
        issues.push({
          code: "unknown_attribute",
          severity: "warning",
          message: `required 값 \"${attrValue}\"를 해석할 수 없습니다.`,
          token,
        });
      } else {
        required = parsed;
      }
      continue;
    }
    if (attrKey === "type") {
      const normalizedType = attrValue.toLowerCase();
      if (KNOWN_TYPES.has(normalizedType as TemplateFieldType)) {
        fieldType = normalizedType as TemplateFieldType;
      } else {
        issues.push({
          code: "invalid_type",
          severity: "error",
          message: `지원하지 않는 필드 타입 \"${attrValue}\"입니다.`,
          token,
        });
      }
      continue;
    }

    issues.push({
      code: "unknown_attribute",
      severity: "warning",
      message: `알 수 없는 템플릿 속성 \"${attrKey}\"는 무시됩니다.`,
      token,
    });
  }

  const originalKey = rawKey.trim();
  const key = normalizeFieldKey(originalKey);
  if (!key) {
    issues.push({
      code: "invalid_tag",
      severity: "error",
      message: "템플릿 필드 키가 비어 있습니다.",
      token,
    });
  }
  if (!label) {
    label = humanizeFieldKey(originalKey || key);
  }
  if (fieldType === "choice" && !options.length) {
    issues.push({
      code: "unknown_attribute",
      severity: "warning",
      message: "choice 타입 필드는 options 속성을 지정하는 것이 좋습니다.",
      token,
      fieldKey: key,
    });
  }

  return {
    key,
    originalKey: originalKey || key,
    type: fieldType,
    label,
    required,
    defaultValue,
    description,
    options,
    token,
    issues,
  };
}

export function buildTemplateCatalogFromDoc(doc: JSONContent | null): TemplateCatalog {
  if (!doc) {
    return {
      version: "tpl-00000000",
      fieldCount: 0,
      rawTagCount: 0,
      fields: [],
      issues: [],
    };
  }

  const issues: TemplateCatalogIssue[] = [];
  const fields = new Map<string, TemplateFieldDefinition>();
  let rawTagCount = 0;

  walk(doc, (node) => {
    if (node.type !== "paragraph" && node.type !== "heading") {
      return;
    }
    const attrs = (node.attrs || {}) as TemplateNodeAttrs;
    const text = extractNodeText(node);
    const matches = Array.from(text.matchAll(TEMPLATE_TAG_PATTERN));
    if (!matches.length) {
      return;
    }

    for (const match of matches) {
      rawTagCount += 1;
      const token = match[0];
      const parsed = parseTemplateTag(token);
      if (!parsed) {
        continue;
      }

      for (const issue of parsed.issues) {
        issues.push({
          ...issue,
          fieldKey: issue.fieldKey ?? parsed.key ?? undefined,
          segmentId: attrs.segmentId ?? null,
          fileName: attrs.fileName ?? null,
        });
      }
      if (!parsed.key) {
        continue;
      }

      const occurrence: TemplateFieldOccurrence = {
        token,
        segmentId: attrs.segmentId ?? null,
        fileName: attrs.fileName ?? null,
        textIndex: attrs.textIndex ?? null,
      };

      const existing = fields.get(parsed.key);
      if (!existing) {
        fields.set(parsed.key, {
          key: parsed.key,
          originalKey: parsed.originalKey,
          type: parsed.type,
          label: parsed.label,
          required: parsed.required,
          defaultValue: parsed.defaultValue,
          description: parsed.description,
          options: parsed.options,
          occurrences: [occurrence],
        });
        continue;
      }

      existing.occurrences.push(occurrence);
      if (existing.type !== parsed.type) {
        issues.push({
          code: "conflicting_type",
          severity: "error",
          message: `필드 \"${parsed.key}\"가 서로 다른 타입(${existing.type}, ${parsed.type})으로 선언되었습니다.`,
          token,
          fieldKey: parsed.key,
          segmentId: attrs.segmentId ?? null,
          fileName: attrs.fileName ?? null,
        });
      }
      if (existing.label !== parsed.label) {
        issues.push({
          code: "conflicting_label",
          severity: "warning",
          message: `필드 \"${parsed.key}\"의 라벨이 일관되지 않습니다.`,
          token,
          fieldKey: parsed.key,
          segmentId: attrs.segmentId ?? null,
          fileName: attrs.fileName ?? null,
        });
      }
      if (existing.required !== parsed.required) {
        issues.push({
          code: "conflicting_required",
          severity: "warning",
          message: `필드 \"${parsed.key}\"의 required 설정이 일관되지 않습니다.`,
          token,
          fieldKey: parsed.key,
          segmentId: attrs.segmentId ?? null,
          fileName: attrs.fileName ?? null,
        });
        existing.required = existing.required || parsed.required;
      }
      const existingOptions = uniqueSorted(existing.options);
      const nextOptions = uniqueSorted(parsed.options);
      if (existingOptions.join("|") !== nextOptions.join("|")) {
        issues.push({
          code: "conflicting_options",
          severity: "warning",
          message: `필드 \"${parsed.key}\"의 옵션 목록이 일관되지 않습니다.`,
          token,
          fieldKey: parsed.key,
          segmentId: attrs.segmentId ?? null,
          fileName: attrs.fileName ?? null,
        });
      }
      if ((existing.defaultValue || "") !== (parsed.defaultValue || "")) {
        issues.push({
          code: "conflicting_default",
          severity: "warning",
          message: `필드 \"${parsed.key}\"의 기본값이 일관되지 않습니다.`,
          token,
          fieldKey: parsed.key,
          segmentId: attrs.segmentId ?? null,
          fileName: attrs.fileName ?? null,
        });
      }
    }
  });

  const sortedFields = Array.from(fields.values())
    .map((field) => ({
      ...field,
      options: uniqueSorted(field.options),
      occurrences: [...field.occurrences].sort((a, b) =>
        `${a.fileName || ""}:${a.textIndex || 0}:${a.segmentId || ""}`.localeCompare(
          `${b.fileName || ""}:${b.textIndex || 0}:${b.segmentId || ""}`,
        ),
      ),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const canonicalVersionInput = JSON.stringify(
    sortedFields.map((field) => ({
      key: field.key,
      type: field.type,
      label: field.label,
      required: field.required,
      defaultValue: field.defaultValue,
      description: field.description,
      options: field.options,
    })),
  );

  return {
    version: `tpl-${fnv1aHash(canonicalVersionInput)}`,
    fieldCount: sortedFields.length,
    rawTagCount,
    fields: sortedFields,
    issues,
  };
}

export function validateTemplateFieldValues(
  catalog: TemplateCatalog,
  values: Record<string, unknown>,
): TemplateValueIssue[] {
  const issues: TemplateValueIssue[] = [];
  const knownFields = new Map(catalog.fields.map((field) => [field.key, field]));

  for (const field of catalog.fields) {
    const value = values[field.key];
    const isMissing =
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim().length === 0) ||
      (Array.isArray(value) && value.length === 0);
    if (field.required && isMissing) {
      issues.push({
        code: "missing_required",
        severity: "error",
        fieldKey: field.key,
        message: `필수 필드 \"${field.label}\"(${field.key}) 값이 없습니다.`,
      });
    }
    if (field.type === "choice" && !isMissing && field.options.length) {
      const selected = Array.isArray(value) ? value.map(String) : [String(value)];
      const invalid = selected.filter((item) => !field.options.includes(item));
      if (invalid.length) {
        issues.push({
          code: "invalid_choice",
          severity: "error",
          fieldKey: field.key,
          message: `필드 \"${field.label}\"(${field.key}) 값 ${invalid.join(", ")} 이(가) 허용된 옵션에 없습니다.`,
        });
      }
    }
  }

  for (const key of Object.keys(values)) {
    if (!knownFields.has(key)) {
      issues.push({
        code: "unknown_field",
        severity: "warning",
        fieldKey: key,
        message: `카탈로그에 없는 필드 \"${key}\" 값이 전달되었습니다.`,
      });
    }
  }

  return issues;
}
