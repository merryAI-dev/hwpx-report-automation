export type ComplexObjectType =
  | "image"
  | "drawing"
  | "bookmark"
  | "field"
  | "footnote"
  | "endnote"
  | "pageControl";

export type ComplexObjectOccurrence = {
  type: ComplexObjectType;
  fileName: string;
  localName: string;
  count: number;
};

export type ComplexObjectCountMap = Record<ComplexObjectType, number>;

export type ComplexObjectReport = {
  sectionCount: number;
  totalCount: number;
  counts: ComplexObjectCountMap;
  occurrences: ComplexObjectOccurrence[];
  warnings: string[];
};

export const COMPLEX_OBJECT_TYPE_LABELS: Record<ComplexObjectType, string> = {
  image: "이미지",
  drawing: "도형/개체",
  bookmark: "북마크",
  field: "필드",
  footnote: "각주",
  endnote: "미주",
  pageControl: "페이지 제어",
};

const EMPTY_COUNTS: ComplexObjectCountMap = {
  image: 0,
  drawing: 0,
  bookmark: 0,
  field: 0,
  footnote: 0,
  endnote: 0,
  pageControl: 0,
};

const IMAGE_TAGS = new Set([
  "pic",
  "image",
  "shapecomponentpicture",
  "shapepicture",
]);

const DRAWING_TAGS = new Set([
  "container",
  "rect",
  "ellipse",
  "arc",
  "curve",
  "line",
  "polygon",
  "connectline",
  "textbox",
  "textart",
  "ole",
  "equation",
  "shapecomponent",
  "shapeobject",
]);

const BOOKMARK_TAGS = new Set([
  "bookmark",
  "bookmarkstart",
  "bookmarkend",
]);

const FIELD_TAGS = new Set([
  "fieldbegin",
  "fieldend",
  "fieldlist",
  "fieldcode",
]);

const FOOTNOTE_TAGS = new Set([
  "footnote",
  "footnoteref",
]);

const ENDNOTE_TAGS = new Set([
  "endnote",
  "endnoteref",
]);

const PAGE_CONTROL_TAGS = new Set([
  "pagenum",
  "pagehiding",
  "header",
  "footer",
  "headerfooter",
]);

function normalizeLocalName(localName: string): string {
  return localName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function classifyComplexObject(localName: string): ComplexObjectType | null {
  const normalized = normalizeLocalName(localName);

  if (IMAGE_TAGS.has(normalized)) {
    return "image";
  }
  if (DRAWING_TAGS.has(normalized)) {
    return "drawing";
  }
  if (BOOKMARK_TAGS.has(normalized)) {
    return "bookmark";
  }
  if (FIELD_TAGS.has(normalized)) {
    return "field";
  }
  if (FOOTNOTE_TAGS.has(normalized)) {
    return "footnote";
  }
  if (ENDNOTE_TAGS.has(normalized)) {
    return "endnote";
  }
  if (PAGE_CONTROL_TAGS.has(normalized)) {
    return "pageControl";
  }
  return null;
}

function cloneCounts(): ComplexObjectCountMap {
  return { ...EMPTY_COUNTS };
}

export function createEmptyComplexObjectReport(sectionCount = 0): ComplexObjectReport {
  const counts = cloneCounts();
  return {
    sectionCount,
    totalCount: 0,
    counts,
    occurrences: [],
    warnings: buildComplexObjectWarnings(sectionCount, counts),
  };
}

export function hasComplexObjectSignal(report: ComplexObjectReport | null | undefined): boolean {
  if (!report) {
    return false;
  }
  return report.sectionCount > 1 || report.totalCount > 0;
}

export function buildComplexObjectWarnings(
  sectionCount: number,
  counts: ComplexObjectCountMap,
): string[] {
  const warnings: string[] = [];

  if (sectionCount > 1) {
    warnings.push(`멀티 섹션 문서(${sectionCount}개 섹션)는 섹션 속성을 원본 XML 기준으로 유지합니다.`);
  }

  if (counts.image > 0) {
    warnings.push(`이미지 ${counts.image}건은 원본 XML로 보존되며 편집기에서 직접 수정되지 않습니다.`);
  }
  if (counts.drawing > 0) {
    warnings.push(`도형/개체 ${counts.drawing}건은 원본 XML로 보존되며 텍스트 편집 대상에서 제외됩니다.`);
  }
  if (counts.bookmark > 0) {
    warnings.push(`북마크 ${counts.bookmark}건은 위치를 유지하지만 편집기에서 이름/범위를 직접 수정하지 않습니다.`);
  }
  if (counts.field > 0) {
    warnings.push(`필드 ${counts.field}건은 원본 구조를 유지하며 필드 코드 편집은 지원하지 않습니다.`);
  }
  if (counts.footnote > 0 || counts.endnote > 0) {
    warnings.push(
      `각주/미주 ${counts.footnote + counts.endnote}건은 원본 구조를 유지하며 편집기에서 직접 수정하지 않습니다.`,
    );
  }
  if (counts.pageControl > 0) {
    warnings.push(`페이지 제어 ${counts.pageControl}건은 원본 레이아웃 설정을 유지하며 편집기에서 직접 수정하지 않습니다.`);
  }

  return warnings;
}

export function collectComplexObjectReport(
  sectionDocs: Array<{ fileName: string; doc: Document }>,
): ComplexObjectReport {
  const counts = cloneCounts();
  const occurrences = new Map<string, ComplexObjectOccurrence>();

  for (const section of sectionDocs) {
    for (const element of Array.from(section.doc.getElementsByTagName("*"))) {
      const type = classifyComplexObject(element.localName);
      if (!type) {
        continue;
      }

      counts[type] += 1;

      const occurrenceKey = `${section.fileName}:${type}:${element.localName}`;
      const occurrence = occurrences.get(occurrenceKey);
      if (occurrence) {
        occurrence.count += 1;
      } else {
        occurrences.set(occurrenceKey, {
          type,
          fileName: section.fileName,
          localName: element.localName,
          count: 1,
        });
      }
    }
  }

  const totalCount = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    sectionCount: sectionDocs.length,
    totalCount,
    counts,
    occurrences: Array.from(occurrences.values()).sort((left, right) => {
      if (left.fileName !== right.fileName) {
        return left.fileName.localeCompare(right.fileName);
      }
      if (left.type !== right.type) {
        return left.type.localeCompare(right.type);
      }
      return left.localName.localeCompare(right.localName);
    }),
    warnings: buildComplexObjectWarnings(sectionDocs.length, counts),
  };
}
