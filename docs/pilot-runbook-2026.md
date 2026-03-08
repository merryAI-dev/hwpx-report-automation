# Pilot Runbook 2026

## 목적
- 파일럿 기간 동안 HWPX 편집, AI 제안, batch job, quality gate 흐름을 매일 운영 가능한 수준으로 관찰한다.

## 시작 전 체크
- `OPENAI_API_KEY` 설정 여부 확인
- HWP intake를 쓸 경우 `HWP_CONVERTER_COMMAND` 설정 확인
- Java 렌더 서버 사용 시 `JAVA_API_URL` 연결 확인
- 샘플 문서 3건 이상으로 로드/저장/배치 제안 재현

## 일일 KPI
- 문서 로드 수
- 수동 저장 수 / 자동 저장 수
- PDF/DOCX 내보내기 수
- batch job 생성/완료/실패 수
- quality gate 차단 수 / 승인 수
- 최근 20개 이벤트에서 반복 실패 유형

## 장애 대응
1. batch job 실패
- `/api/pilot/summary`에서 실패 job과 최근 update 시각 확인
- AI provider 설정 및 최근 프롬프트 변경 여부 점검
- 동일 입력으로 재시도 후 재현 여부 확인

2. quality gate 차단 증가
- 누락된 숫자/날짜/토큰 패턴이 무엇인지 확인
- 금지어 정책 변경이나 문서 유형 변화가 있었는지 확인
- 승인 절차로 우회 적용할지 운영 기준에 따라 판단

3. 저장/내보내기 실패
- 무결성 경고 메시지 확인
- 브라우저 fallback 다운로드 동작 확인
- 최근 파일 스냅샷으로 복구 가능한지 확인
