export type HwpxCompatibilityStatus = "supported" | "partial" | "unsupported";
export type HwpxExportBehavior = "preserve" | "patch_existing_only" | "warn_and_skip";

export type HwpxCompatibilityEntry = {
  key: string;
  area: "text" | "table" | "paragraph-style";
  label: string;
  status: HwpxCompatibilityStatus;
  exportBehavior: HwpxExportBehavior;
  warningCode?: string;
  warningMessage?: string;
};

export const HWPX_COMPATIBILITY_MATRIX: Record<string, HwpxCompatibilityEntry> = {
  "text.metadata-bound-segment": {
    key: "text.metadata-bound-segment",
    area: "text",
    label: "원본 segmentId가 연결된 텍스트 블록",
    status: "supported",
    exportBehavior: "preserve",
  },
  "text.new-block-without-metadata": {
    key: "text.new-block-without-metadata",
    area: "text",
    label: "metadata 없는 신규 텍스트 블록",
    status: "unsupported",
    exportBehavior: "warn_and_skip",
    warningCode: "HWPX-TEXT-NO-METADATA",
    warningMessage: "metadata 없는 새 텍스트 블록은 현재 HWPX 내보내기에서 제외됩니다.",
  },
  "text.unknown-segment-id": {
    key: "text.unknown-segment-id",
    area: "text",
    label: "원본과 연결되지 않은 segmentId 텍스트",
    status: "unsupported",
    exportBehavior: "warn_and_skip",
    warningCode: "HWPX-TEXT-UNKNOWN-SEGMENT",
    warningMessage: "알 수 없는 segmentId 텍스트는 현재 HWPX 내보내기에서 제외됩니다.",
  },
  "table.patch-existing-table": {
    key: "table.patch-existing-table",
    area: "table",
    label: "원본 tableId가 있는 기존 표",
    status: "partial",
    exportBehavior: "patch_existing_only",
  },
  "table.new-table-without-id": {
    key: "table.new-table-without-id",
    area: "table",
    label: "원본 tableId 없는 신규 표",
    status: "unsupported",
    exportBehavior: "warn_and_skip",
    warningCode: "HWPX-TABLE-NO-ID",
    warningMessage: "새로 추가된 표는 원본 tableId가 없어 HWPX 구조 반영에서 제외됩니다.",
  },
  "table.invalid-table-id": {
    key: "table.invalid-table-id",
    area: "table",
    label: "형식이 잘못된 tableId",
    status: "unsupported",
    exportBehavior: "warn_and_skip",
    warningCode: "HWPX-TABLE-INVALID-ID",
    warningMessage: "형식이 잘못된 tableId 표는 HWPX 구조 반영에서 제외됩니다.",
  },
  "paragraph-style.letter-spacing-without-charpr": {
    key: "paragraph-style.letter-spacing-without-charpr",
    area: "paragraph-style",
    label: "charPrIDRef 없는 자간 변경",
    status: "partial",
    exportBehavior: "warn_and_skip",
    warningCode: "HWPX-CHARPR-MISSING",
    warningMessage: "charPrIDRef를 찾지 못한 자간 변경은 HWPX 반영에서 제외됩니다.",
  },
};

export type HwpxCompatibilityKey = keyof typeof HWPX_COMPATIBILITY_MATRIX;

export function getCompatibilityEntry(key: HwpxCompatibilityKey): HwpxCompatibilityEntry {
  return HWPX_COMPATIBILITY_MATRIX[key];
}

export function buildCompatibilityWarning(
  key: HwpxCompatibilityKey,
  detail?: string,
): string {
  const entry = getCompatibilityEntry(key);
  if (!entry.warningCode || !entry.warningMessage) {
    throw new Error(`Compatibility entry ${key} does not define a warning.`);
  }

  const suffix = detail ? ` (${detail})` : "";
  return `[${entry.warningCode}] ${entry.warningMessage}${suffix}`;
}
