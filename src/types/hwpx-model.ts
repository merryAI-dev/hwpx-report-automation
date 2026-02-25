/**
 * OWPML In-Memory Document Model
 *
 * HWPX 라운드트립을 위한 <hp:p> 단위 문서 모델.
 * 파싱 시 모든 <hp:p> 요소를 HwpxParaNode로 캡처하고,
 * 익스포트 시 paraStore를 순회하여 섹션 XML을 재조립한다.
 */

/**
 * 하나의 <hp:run> 정보.
 * globalTextIndex: 섹션 파일 전체에서 몇 번째 텍스트 노드인지
 * (XmlSegment.textIndex와 동일한 값 — segmentId의 숫자 부분과 일치)
 */
export type HwpxRun = {
  globalTextIndex: number; // -1 = 합성 문단
  charPrIDRef: string | null; // header.xml charProperties 참조
  text: string; // 파싱 시점 텍스트
};

/**
 * 하나의 <hp:p> 요소 전체 모델.
 * paraId는 파싱 시 crypto.randomUUID()로 생성, ProseMirror attrs와 연결 키.
 */
export type HwpxParaNode = {
  paraId: string;
  paraXml: string; // 완전한 <hp:p>...</hp:p> raw XML
  runs: HwpxRun[]; // 문서 순서 런 목록
  hasContent: boolean; // false = <hp:t>가 없는 빈/구조 문단
  sourceSegmentId: string | null; // 하위호환용 — 기존 segmentId
  isSynthesized: boolean; // true = appendTransaction 생성 (HWPX 원본 없음)
};

/**
 * 섹션 XML의 루트 직계 자식 하나.
 * "para"는 paraStore 참조, "raw"는 테이블·colDef 등 verbatim XML.
 * leadingWhitespace: 이전 블록 끝 ~ 이 블록 시작 사이의 공백·줄바꿈
 * (원본 XML 포매팅 보존용)
 */
export type HwpxBlockSlot =
  | { type: "para"; paraId: string; leadingWhitespace: string }
  | { type: "raw"; xml: string; leadingWhitespace: string };

/**
 * 하나의 섹션 XML 파일 전체 구조.
 * xmlPrefix = XML 선언 + 루트 여는 태그
 * xmlSuffix = 루트 닫는 태그 (예: </hp:sec>)
 */
export type HwpxSectionModel = {
  fileName: string;
  xmlPrefix: string;
  blocks: HwpxBlockSlot[];
  xmlSuffix: string;
};

/**
 * 문서 전체 모델. Zustand 스토어에 단일 참조로 보관.
 * paraStore: Map이므로 Zustand shallow re-render로는 변경 감지 안 됨 —
 *   appendTransaction 이후 setHwpxDocumentModel(model) 호출로 동일 참조를
 *   재설정하여 export 경로가 최신 Map을 읽도록 강제.
 */
export type HwpxDocumentModel = {
  sections: HwpxSectionModel[];
  paraStore: Map<string, HwpxParaNode>;
  headerXml: string; // Contents/header.xml raw 텍스트
  baseBuffer: ArrayBuffer; // 익스포트 베이스 ZIP (HWPX 원본 또는 템플릿)
};
