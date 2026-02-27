import { scanXmlTextSegments, applyEditsToXmlText } from "../hwpx";
import type { HwpxParaNode, HwpxRun } from "../../types/hwpx-model";

/**
 * paraXml의 모든 텍스트 노드를 공백화.
 * <hp:t>내용</hp:t> → <hp:t></hp:t>
 * <![CDATA[내용]]> → <![CDATA[]]>
 */
export function clearParaRunTexts(paraXml: string): string {
  const segments = scanXmlTextSegments(paraXml);
  if (segments.length === 0) return paraXml;

  const patchMap = new Map<number, string>();
  for (const seg of segments) {
    patchMap.set(seg.textIndex, "");
  }
  return applyEditsToXmlText(paraXml, patchMap);
}

/**
 * 새 문단 노드를 위한 HwpxParaNode 합성.
 * siblingPara의 paraXml 구조를 복사하고 텍스트만 비운다.
 * charPrIDRef는 sibling 첫 번째 런에서 상속.
 *
 * sectionFileName 파라미터는 미래 다중 섹션 지원을 위해 시그니처에 포함.
 */
export function synthesizeParaNode(
  siblingPara: HwpxParaNode | null,
  newParaId: string,
  _sectionFileName: string,
): HwpxParaNode {
  if (!siblingPara) {
    // 최소 OWPML 문단 (namespace는 루트에서 상속되므로 익스포트 시 문제없음)
    const minimalXml = `<hp:p><hp:run><hp:t></hp:t></hp:run></hp:p>`;
    const run: HwpxRun = {
      globalTextIndex: -1,
      charPrIDRef: null,
      text: "",
    };
    return {
      paraId: newParaId,
      paraXml: minimalXml,
      runs: [run],
      hasContent: false,
      sourceSegmentId: null,
      isSynthesized: true,
    };
  }

  const blankXml = clearParaRunTexts(siblingPara.paraXml);

  // 합성된 런: sibling 첫 번째 런의 charPrIDRef 상속, text=""
  // globalTextIndex는 -1 (합성 문단은 로컬 인덱스로만 패칭)
  const firstRun: HwpxRun = {
    globalTextIndex: -1,
    charPrIDRef: siblingPara.runs[0]?.charPrIDRef ?? null,
    text: "",
  };

  return {
    paraId: newParaId,
    paraXml: blankXml,
    runs: [firstRun],
    hasContent: false,
    sourceSegmentId: null,
    isSynthesized: true,
  };
}
