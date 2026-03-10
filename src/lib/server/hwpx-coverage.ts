import JSZip from "jszip";

export type CoverageStatus = "supported" | "partial" | "unsupported" | "ignored";

export type CoverageFeature = {
  id: string;
  xmlElement: string;
  description: string;
  status: CoverageStatus;
  notes?: string;
};

export const HWPX_COVERAGE_MATRIX: CoverageFeature[] = [
  // Supported
  {
    id: "para",
    xmlElement: "hp:p",
    description: "텍스트 문단",
    status: "supported",
  },
  {
    id: "run",
    xmlElement: "hp:run",
    description: "텍스트 런(인라인 텍스트 블록)",
    status: "supported",
  },
  {
    id: "text",
    xmlElement: "hp:t",
    description: "텍스트 내용",
    status: "supported",
  },
  {
    id: "table",
    xmlElement: "hp:tbl",
    description: "표(기본)",
    status: "supported",
  },
  {
    id: "table_row",
    xmlElement: "hp:tr",
    description: "표 행",
    status: "supported",
  },
  {
    id: "table_cell",
    xmlElement: "hp:tc",
    description: "표 셀",
    status: "supported",
  },
  {
    id: "section",
    xmlElement: "hp:sec",
    description: "섹션",
    status: "supported",
  },
  {
    id: "page_break",
    xmlElement: "hp:pageBreak",
    description: "페이지 나누기",
    status: "supported",
  },
  {
    id: "line_break",
    xmlElement: "hp:lineBreak",
    description: "줄 나누기",
    status: "supported",
  },
  {
    id: "heading",
    xmlElement: "hp:heading",
    description: "제목(헤딩)",
    status: "supported",
  },
  {
    id: "list_item",
    xmlElement: "hp:li",
    description: "목록 항목",
    status: "supported",
  },
  {
    id: "bold",
    xmlElement: "hp:bold",
    description: "굵게",
    status: "supported",
  },
  {
    id: "italic",
    xmlElement: "hp:italic",
    description: "기울임",
    status: "supported",
  },
  {
    id: "underline",
    xmlElement: "hp:underline",
    description: "밑줄",
    status: "supported",
  },
  {
    id: "image",
    xmlElement: "hp:img",
    description: "이미지(보존)",
    status: "supported",
    notes: "바이너리 데이터는 원본 유지",
  },
  {
    id: "column_def",
    xmlElement: "hp:colDef",
    description: "열 정의",
    status: "supported",
  },

  // Partial
  {
    id: "char_shape",
    xmlElement: "hp:charShape",
    description: "문자 모양(일부 속성 손실 가능)",
    status: "partial",
    notes: "폰트 크기·색상은 보존되나 일부 고급 속성 미지원",
  },
  {
    id: "para_shape",
    xmlElement: "hp:paraShape",
    description: "문단 모양(일부 속성 손실 가능)",
    status: "partial",
    notes: "들여쓰기·정렬은 보존, 탭·경계선 미지원",
  },
  {
    id: "nested_table",
    xmlElement: "hp:tbl>hp:tbl",
    description: "중첩 표",
    status: "partial",
    notes: "1단계 중첩만 지원",
  },
  {
    id: "footnote",
    xmlElement: "hp:fn",
    description: "각주",
    status: "partial",
    notes: "텍스트 추출은 되나 위치/번호 정보 손실",
  },
  {
    id: "endnote",
    xmlElement: "hp:en",
    description: "미주",
    status: "partial",
    notes: "텍스트 추출은 되나 위치/번호 정보 손실",
  },
  {
    id: "hyperlink",
    xmlElement: "hp:hyperlink",
    description: "하이퍼링크",
    status: "partial",
    notes: "URL은 보존되나 스타일 손실 가능",
  },
  {
    id: "text_style",
    xmlElement: "hp:textStyle",
    description: "텍스트 스타일(일부 속성 손실)",
    status: "partial",
  },

  // Unsupported
  {
    id: "macro",
    xmlElement: "hp:macro",
    description: "매크로",
    status: "unsupported",
    notes: "매크로 실행 환경 미지원",
  },
  {
    id: "ole_object",
    xmlElement: "hp:ole",
    description: "OLE 객체",
    status: "unsupported",
    notes: "OLE 바인딩 미지원",
  },
  {
    id: "form_field",
    xmlElement: "hp:form",
    description: "폼 필드",
    status: "unsupported",
  },
  {
    id: "equation",
    xmlElement: "hp:eq",
    description: "수식(복잡한 수식)",
    status: "unsupported",
    notes: "MathML 변환 미지원",
  },
  {
    id: "drawing",
    xmlElement: "hp:shapeObj",
    description: "도형/그리기 객체",
    status: "unsupported",
  },

  // Ignored
  {
    id: "metadata",
    xmlElement: "hp:docInfo",
    description: "문서 메타데이터(라운드트립 안전)",
    status: "ignored",
    notes: "변환 없이 원본 보존",
  },
  {
    id: "header_xml",
    xmlElement: "hp:head",
    description: "헤더 XML(스타일 정의 등)",
    status: "ignored",
    notes: "원본 그대로 유지",
  },
  {
    id: "mimetype",
    xmlElement: "mimetype",
    description: "MIME 타입 파일",
    status: "ignored",
    notes: "패키징 메타데이터",
  },
];

export type HwpxFeatureUsage = {
  featureId: string;
  xmlElement: string;
  count: number;
  status: CoverageStatus;
};

export type HwpxCoverageReport = {
  fileName: string;
  totalElements: number;
  supportedCount: number;
  partialCount: number;
  unsupportedCount: number;
  ignoredCount: number;
  coverageScore: number;
  features: HwpxFeatureUsage[];
  unknownElements: Array<{ xmlElement: string; count: number }>;
  warnings: string[];
};

const SECTION_FILE_RE = /^Contents\/section\d+\.xml$/;

export async function analyzeHwpxCoverage(
  fileBuffer: ArrayBuffer,
  fileName?: string,
): Promise<HwpxCoverageReport> {
  const warnings: string[] = [];
  const elementCounts = new Map<string, number>();

  let zip: ReturnType<typeof JSZip.prototype.loadAsync> extends Promise<infer T> ? T : never;
  try {
    zip = await JSZip.loadAsync(fileBuffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ZIP 로딩 실패";
    warnings.push(`ZIP 로딩 실패: ${message}`);
    return {
      fileName: fileName ?? "unknown.hwpx",
      totalElements: 0,
      supportedCount: 0,
      partialCount: 0,
      unsupportedCount: 0,
      ignoredCount: 0,
      coverageScore: 0,
      features: [],
      unknownElements: [],
      warnings,
    };
  }

  const sectionFiles = Object.keys(zip.files).filter((name) => SECTION_FILE_RE.test(name));
  if (sectionFiles.length === 0) {
    warnings.push("섹션 XML 파일을 찾지 못했습니다. (Contents/section*.xml)");
  }

  for (const sectionFile of sectionFiles) {
    const item = zip.files[sectionFile];
    if (!item || item.dir) {
      continue;
    }
    let xmlText: string;
    try {
      xmlText = await item.async("string");
    } catch {
      warnings.push(`XML 읽기 실패: ${sectionFile}`);
      continue;
    }

    // Count all hp: element occurrences using regex scanning
    const elementPattern = /<(hp:[a-zA-Z][a-zA-Z0-9]*)/g;
    let match: RegExpExecArray | null;
    while ((match = elementPattern.exec(xmlText)) !== null) {
      const tag = match[1];
      elementCounts.set(tag, (elementCounts.get(tag) ?? 0) + 1);
    }
  }

  // Build a lookup map from xmlElement -> CoverageFeature
  // For simple (non-nested) elements only
  const featureByElement = new Map<string, CoverageFeature>();
  for (const feature of HWPX_COVERAGE_MATRIX) {
    // skip compound keys like "hp:tbl>hp:tbl"
    if (!feature.xmlElement.includes(">")) {
      featureByElement.set(feature.xmlElement, feature);
    }
  }

  const featureUsageMap = new Map<string, HwpxFeatureUsage>();
  const knownElements = new Set<string>();

  for (const [xmlElement, count] of elementCounts) {
    const feature = featureByElement.get(xmlElement);
    if (feature) {
      knownElements.add(xmlElement);
      const existing = featureUsageMap.get(feature.id);
      if (existing) {
        existing.count += count;
      } else {
        featureUsageMap.set(feature.id, {
          featureId: feature.id,
          xmlElement,
          count,
          status: feature.status,
        });
      }
    }
  }

  // Unknown elements
  const unknownElements: Array<{ xmlElement: string; count: number }> = [];
  for (const [xmlElement, count] of elementCounts) {
    if (!knownElements.has(xmlElement)) {
      unknownElements.push({ xmlElement, count });
    }
  }
  unknownElements.sort((a, b) => b.count - a.count);

  const features = Array.from(featureUsageMap.values());
  features.sort((a, b) => b.count - a.count);

  let supportedCount = 0;
  let partialCount = 0;
  let unsupportedCount = 0;
  let ignoredCount = 0;
  let totalMatchedOccurrences = 0;
  let weightedScore = 0;

  for (const usage of features) {
    totalMatchedOccurrences += usage.count;
    if (usage.status === "supported") {
      supportedCount += usage.count;
      weightedScore += usage.count * 1.0;
    } else if (usage.status === "partial") {
      partialCount += usage.count;
      weightedScore += usage.count * 0.5;
    } else if (usage.status === "unsupported") {
      unsupportedCount += usage.count;
    } else if (usage.status === "ignored") {
      ignoredCount += usage.count;
    }
  }

  // For score, also count unknown elements as unsupported
  const unknownTotal = unknownElements.reduce((sum, e) => sum + e.count, 0);
  const grandTotal = totalMatchedOccurrences + unknownTotal;

  const coverageScore =
    grandTotal > 0 ? Math.round((weightedScore / grandTotal) * 100) : 100;

  return {
    fileName: fileName ?? "unknown.hwpx",
    totalElements: grandTotal,
    supportedCount,
    partialCount,
    unsupportedCount,
    ignoredCount,
    coverageScore,
    features,
    unknownElements,
    warnings,
  };
}
