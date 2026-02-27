export type PresetKey =
  | "technical_proposal"
  | "official_document"
  | "research_report"
  | "business_plan"
  | "korean_proofreading"
  | "honorific_unify"
  | "concise_rewrite"
  | "yearly_update"
  | "custom";

export type InstructionPreset = {
  key: PresetKey;
  label: string;
  instruction: string;
};

export const INSTRUCTION_PRESETS: InstructionPreset[] = [
  {
    key: "technical_proposal",
    label: "기술제안서",
    instruction:
      "기술 제안서 톤으로 다듬어라. 평가위원이 30초 내 핵심을 파악할 수 있도록 간결하게 작성하라. 전문 용어는 유지하되 수동태보다 능동태를 사용하고, 정량적 근거를 보강하라.",
  },
  {
    key: "official_document",
    label: "공문서",
    instruction:
      "공문서 어투(합쇼체, '~함' 체)로 수정하라. 행정용어를 정확하게 사용하고, 높임말을 통일하라. 불필요한 미사여구를 제거하고 간결하게 작성하라.",
  },
  {
    key: "research_report",
    label: "연구보고서",
    instruction:
      "학술 연구보고서 톤으로 수정하라. 객관적 서술체를 사용하고, 인과관계를 명확히 하라. 약어 사용 시 최초 언급에서 풀어쓰고, 인용 형식을 보존하라.",
  },
  {
    key: "business_plan",
    label: "사업계획서",
    instruction:
      "사업계획서 톤으로 다듬어라. 수치와 근거를 강조하고 실현 가능성이 드러나도록 서술하라. 모호한 표현을 구체적 수치로 바꾸고 투자자 관점에서 설득력 있게 작성하라.",
  },
  {
    key: "korean_proofreading",
    label: "맞춤법/띄어쓰기",
    instruction:
      "한국어 맞춤법과 띄어쓰기를 교정하라. 국립국어원 표준어 규정을 따르고, 자주 틀리는 표현(예: '되'와 '돼', '로서'와 '로써', 사이시옷, 두음법칙)을 정확하게 수정하라. 의미나 문체는 변경하지 말고 표기법만 수정하라.",
  },
  {
    key: "honorific_unify",
    label: "존댓말 통일",
    instruction:
      "문서 전체의 존댓말 레벨을 합쇼체(~합니다, ~입니다)로 통일하라. 해요체(~해요), 해라체(~한다), 반말이 섞여있으면 모두 합쇼체로 변환하라. 명사형 종결(~함, ~임)은 보존하되, 서술문은 반드시 합쇼체로 맞춰라.",
  },
  {
    key: "concise_rewrite",
    label: "간결하게 다듬기",
    instruction:
      "문장을 간결하고 명확하게 다듬어라. 불필요한 수식어, 중복 표현, 피동 표현을 제거하고 능동태로 변환하라. 핵심 정보를 앞으로 배치하고, 한 문장이 50자를 넘지 않도록 분리하라. 원문의 의미는 보존하라.",
  },
  {
    key: "yearly_update",
    label: "연도/수치 업데이트",
    instruction:
      "이 문서는 작년도 문서를 올해 기준으로 업데이트하려는 것이다. 다음을 수행하라: 1) 연도 표기(2024→2025, 제N기→제N+1기 등)를 최신으로 변경하라. 2) 날짜/기간 표현을 현행화하라. 3) 수치나 통계가 포함된 부분은 [업데이트 필요]로 표시하여 사용자가 확인할 수 있게 하라. 4) 정책 용어나 제도명이 변경되었을 가능성이 있는 부분도 [확인 필요]로 표시하라. 서식과 문체는 원본 그대로 유지하라.",
  },
  {
    key: "custom",
    label: "직접 입력",
    instruction: "",
  },
];
