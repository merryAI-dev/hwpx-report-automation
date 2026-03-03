import type { PresetKey } from "./ai-presets";

export type DocumentTemplate = {
  id: string;
  name: string;
  description: string;
  category: "report" | "proposal" | "official" | "plan";
  icon: string;
  defaultPreset: PresetKey;
  /** Starter document structure as ProseMirror JSON content items */
  starterContent: Array<{
    type: string;
    attrs?: Record<string, unknown>;
    content?: Array<{ type: string; text?: string; marks?: Array<{ type: string }> }>;
  }>;
};

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "tech-proposal",
    name: "기술 제안서",
    description: "기술 평가용 제안서 양식. 핵심 기술, 방법론, 추진 계획 구조 포함.",
    category: "proposal",
    icon: "📋",
    defaultPreset: "technical_proposal",
    starterContent: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "[프로젝트명] 기술 제안서" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "1. 사업 개요" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "본 제안서는 [대상 사업]에 대한 기술적 접근 방법과 추진 계획을 기술합니다." }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "2. 핵심 기술 및 방법론" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[핵심 기술과 차별화 포인트를 기술하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "3. 추진 일정" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[단계별 추진 일정과 산출물을 기술하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "4. 투입 인력 및 조직" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[투입 인력의 역할과 경력을 기술하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "5. 기대 효과" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[정량적/정성적 기대 효과를 기술하세요.]" }],
      },
    ],
  },
  {
    id: "official-letter",
    name: "공문서",
    description: "행정기관 공문서 양식. 수신, 참조, 제목, 본문 구조 포함.",
    category: "official",
    icon: "📄",
    defaultPreset: "official_document",
    starterContent: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "[발신기관명]", marks: [{ type: "bold" }] }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "수신: [수신기관/부서]" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "참조: [참조자]" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "제목: [공문 제목]", marks: [{ type: "bold" }] }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "1. [관련 근거 또는 배경을 기술합니다.]" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "2. [요청 사항 또는 알림 내용을 기술합니다.]" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "3. [세부 사항이나 첨부 안내를 기술합니다.]" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "끝." }],
      },
    ],
  },
  {
    id: "research-report",
    name: "연구 보고서",
    description: "연구 결과 보고서 양식. 서론, 연구 방법, 결과, 결론 구조 포함.",
    category: "report",
    icon: "🔬",
    defaultPreset: "research_report",
    starterContent: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "[연구 과제명] 연구 보고서" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "요약" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[연구 목적, 방법, 주요 결과를 200자 이내로 요약하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "1. 서론" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[연구 배경과 목적을 기술하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "2. 연구 방법" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[연구 설계, 데이터 수집, 분석 방법을 기술하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "3. 연구 결과" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[주요 연구 결과를 기술하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "4. 결론 및 제언" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[결론과 향후 연구 방향을 기술하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "참고문헌" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[참고문헌 목록]" }],
      },
    ],
  },
  {
    id: "business-plan",
    name: "사업 계획서",
    description: "사업 계획서 양식. 시장 분석, 사업 모델, 재무 계획 구조 포함.",
    category: "plan",
    icon: "💼",
    defaultPreset: "business_plan",
    starterContent: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "[사업명] 사업 계획서" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "1. 사업 개요" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[사업의 비전과 핵심 가치를 기술하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "2. 시장 분석" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[시장 규모, 경쟁 환경, 목표 고객을 분석하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "3. 사업 모델" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[수익 모델, 가치 제안, 핵심 파트너를 기술하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "4. 마케팅 전략" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[고객 확보 및 유지 전략을 기술하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "5. 재무 계획" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[매출 전망, 비용 구조, 손익 계획을 기술하세요.]" }],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "6. 추진 일정" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "[분기별 주요 마일스톤을 기술하세요.]" }],
      },
    ],
  },
];
