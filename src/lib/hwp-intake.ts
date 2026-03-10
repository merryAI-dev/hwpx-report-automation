const LEGACY_HWP_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const ZIP_LOCAL_FILE_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;
const ZIP_EMPTY_ARCHIVE_SIGNATURE = [0x50, 0x4b, 0x05, 0x06] as const;
const ZIP_SPANNED_SIGNATURE = [0x50, 0x4b, 0x07, 0x08] as const;

export type BinarySignatureKind = "compound-file" | "zip" | "unknown";

export type HwpIntakeDisposition = "convertible-hwp" | "zip-disguised-as-hwp" | "unsupported";

export type HwpIntakeReport = {
  fileName: string;
  extension: string;
  detectedSignature: BinarySignatureKind;
  signatureHex: string;
  disposition: HwpIntakeDisposition;
  canConvert: boolean;
  suggestedOutputFileName: string;
  issues: string[];
  summary: string;
};

function matchesSignature(input: Uint8Array, signature: readonly number[]): boolean {
  if (input.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => input[index] === byte);
}

function getExtension(fileName: string): string {
  const lower = fileName.trim().toLowerCase();
  const idx = lower.lastIndexOf(".");
  if (idx === -1) {
    return "";
  }
  return lower.slice(idx + 1);
}

function toSignatureHex(input: Uint8Array, length = 8): string {
  return Array.from(input.slice(0, length))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

export function detectBinarySignature(input: ArrayBuffer | Uint8Array): BinarySignatureKind {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (matchesSignature(bytes, LEGACY_HWP_SIGNATURE)) {
    return "compound-file";
  }
  if (
    matchesSignature(bytes, ZIP_LOCAL_FILE_SIGNATURE)
    || matchesSignature(bytes, ZIP_EMPTY_ARCHIVE_SIGNATURE)
    || matchesSignature(bytes, ZIP_SPANNED_SIGNATURE)
  ) {
    return "zip";
  }
  return "unknown";
}

export function inspectHwpUpload(fileName: string, fileBuffer: ArrayBuffer): HwpIntakeReport {
  const extension = getExtension(fileName);
  const bytes = new Uint8Array(fileBuffer);
  const detectedSignature = detectBinarySignature(bytes);
  const signatureHex = toSignatureHex(bytes);
  const issues: string[] = [];
  let disposition: HwpIntakeDisposition = "unsupported";

  if (!fileName.trim()) {
    issues.push("파일 이름이 비어 있습니다.");
  }

  if (extension !== "hwp") {
    issues.push("레거시 HWP 변환은 `.hwp` 파일만 지원합니다.");
  }

  if (detectedSignature === "compound-file") {
    disposition = extension === "hwp" ? "convertible-hwp" : "unsupported";
    if (extension === "hwp") {
      // expected path
    }
  } else if (detectedSignature === "zip") {
    disposition = "zip-disguised-as-hwp";
    issues.push("ZIP 시그니처가 감지되었습니다. HWPX나 일반 ZIP 파일을 `.hwp`로 업로드한 것일 수 있습니다.");
  } else {
    issues.push("레거시 HWP(Compound File) 시그니처를 확인하지 못했습니다.");
  }

  const suggestedOutputFileName = fileName.trim().toLowerCase().endsWith(".hwp")
    ? `${fileName.trim().slice(0, -4)}.hwpx`
    : `${fileName.trim() || "document"}.hwpx`;

  const canConvert = extension === "hwp" && detectedSignature === "compound-file";
  const summary = canConvert
    ? "레거시 HWP 후보 파일로 확인되어 외부 변환기에 전달할 수 있습니다."
    : issues[0] || "HWP intake 조건을 만족하지 않습니다.";

  return {
    fileName,
    extension,
    detectedSignature,
    signatureHex,
    disposition,
    canConvert,
    suggestedOutputFileName,
    issues,
    summary,
  };
}

export function createSyntheticLegacyHwpBuffer(payload = "mock-hwp-payload"): ArrayBuffer {
  const body = new TextEncoder().encode(payload);
  const bytes = new Uint8Array(LEGACY_HWP_SIGNATURE.length + body.length);
  bytes.set(LEGACY_HWP_SIGNATURE, 0);
  bytes.set(body, LEGACY_HWP_SIGNATURE.length);
  return bytes.buffer.slice(0);
}

export { LEGACY_HWP_SIGNATURE };
