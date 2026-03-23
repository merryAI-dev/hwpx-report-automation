import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { applyTextEdits, inspectHwpx } from "../src/lib/hwpx";
import { formatHwpxValidationReport, validateHwpxForNode } from "../src/lib/node/hwpx-validator";

async function main() {
  const dom = new JSDOM("");
  (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = dom.window.DOMParser;
  (globalThis as unknown as { NodeFilter: typeof NodeFilter }).NodeFilter = dom.window.NodeFilter;

  const today = new Date().toISOString().slice(0, 10);
  const inputPath = path.resolve(process.cwd(), "../examples/input-sample.hwpx");
  const outputPath = path.resolve(process.cwd(), "../examples/today-project-report.hwpx");

  const reportLines = [
    "오늘 작업 보고서",
    `${today}`,
    "프로젝트: HWPX Studio",
    "목표: HWPX 자동 편집 시스템의 실사용 가능성 검증",
    "1. 구현 요약",
    "- HWPX 업로드/노드 탐색/스타일 카탈로그 UI 구현",
    "- 단건 AI 제안 및 일괄 제안 API(/api/suggest, /api/suggest-batch) 구현",
    "- 수정 큐 적용 후 HWPX 재생성 기능 구현",
    "2. 안정성 개선",
    "- XML 전체 재직렬화 대신 텍스트 구간 치환 방식으로 변경",
    "- HWPX 무결성 검사(mimetype, version.xml, content.hpf, XML 파싱) 추가",
    "- 손상 리스크 경고를 UI에서 즉시 표시",
    "3. UX 개선",
    "- Undo/Redo(버튼 + 단축키) 구현",
    "- 헤딩 기반 섹션 자동 선택 구현",
    "- 원문/제안 Diff 미리보기 구현",
    "4. 테스트 결과",
    "- lint 통과",
    "- test 통과(Undo/Redo, 섹션 선택, 무결성)",
    "- build 통과",
    "5. 다음 단계",
    "- 실제 업무 HWPX 샘플 다건 회귀 테스트",
    "- 스타일 규칙 사전(템플릿별) 보강",
    "- 배포 환경에서 API 키 연결 후 문서 생성 자동화 확장",
    "끝.",
  ];

  const input = await fs.readFile(inputPath);
  const inputBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const beforeReport = await validateHwpxForNode(inputBuffer);
  if (beforeReport.issues.length) {
    throw new Error(formatHwpxValidationReport("input", beforeReport));
  }

  const inspected = await inspectHwpx(inputBuffer);
  const sectionNodes = inspected.textNodes.filter(
    (node) => node.fileName === "Contents/section0.xml" && node.text.trim().length > 0,
  );
  if (sectionNodes.length < reportLines.length) {
    throw new Error(
      `보고서 라인(${reportLines.length})보다 대상 노드(${sectionNodes.length})가 적습니다.`,
    );
  }

  const edits = reportLines.map((line, idx) => {
    const node = sectionNodes[idx];
    return {
      id: node.id,
      fileName: node.fileName,
      textIndex: node.textIndex,
      oldText: node.text,
      newText: line,
    };
  });

  const outputBlob = await applyTextEdits(inputBuffer, edits);
  const outputArray = new Uint8Array(await outputBlob.arrayBuffer());
  const afterReport = await validateHwpxForNode(outputArray.buffer);
  if (afterReport.issues.length) {
    throw new Error(formatHwpxValidationReport("output", afterReport));
  }

  await fs.writeFile(outputPath, outputArray);
  console.log(`created: ${outputPath}`);
  console.log(`applied edits: ${edits.length}`);
  console.log(formatHwpxValidationReport("output", afterReport));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
