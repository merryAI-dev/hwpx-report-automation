export type RunbookSection = {
  title: string;
  bullets: string[];
};

export const PILOT_RUNBOOK: RunbookSection[] = [
  {
    title: "Pilot Start",
    bullets: [
      "파일럿 대상 문서 유형과 허용 포맷(HWPX/DOCX/PPTX/HWP)을 확정합니다.",
      "`OPENAI_API_KEY`와 운영용 변환기 커맨드, Java 렌더 서버 여부를 점검합니다.",
      "테스트 샘플 3건 이상으로 문서 로드, 저장, 배치 제안 흐름을 사전 점검합니다.",
    ],
  },
  {
    title: "Daily Checks",
    bullets: [
      "문서 로드 성공 수, 수동 저장 수, batch job 실패 수를 오전/오후 두 차례 확인합니다.",
      "quality gate 차단률이 급증하면 금지어 정책이나 프롬프트 변화 여부를 확인합니다.",
      "실패한 batch job은 최근 이벤트와 서버 job 상태를 함께 대조합니다.",
    ],
  },
  {
    title: "Incident Response",
    bullets: [
      "batch job 실패 시: `/api/pilot/summary`에서 실패 건을 확인하고 최근 배포/환경변수 변경 여부를 먼저 점검합니다.",
      "quality gate 과차단 시: 원문 핵심 토큰 패턴과 금지어 목록을 검토하고, 승인 절차로 우회 적용 가능한지 판단합니다.",
      "저장 실패 시: HWPX 무결성 경고, 외부 변환기, 브라우저 다운로드 fallback 순으로 절차적으로 확인합니다.",
    ],
  },
];
