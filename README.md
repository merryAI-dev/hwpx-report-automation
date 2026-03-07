# HWPX Editor (Vercel)

Vercel에 바로 배포 가능한 HWPX 편집기입니다.

- HWPX 업로드 후 텍스트 노드 탐색
- 스타일 속성 카탈로그 확인
- 스타일 유지 텍스트 수정 큐 적용
- AI 제안 생성 (`/api/suggest`)
- 일괄 섹션 재작성 (`/api/suggest-batch`)
- 원문/제안 diff 프리뷰
- `{{TITLE}}` 같은 플레이스홀더 치환
- 템플릿 메타태그 카탈로그 추출 (`{{TITLE}}`, `{{date:report_date|required|label=보고일}}`)

## Local Run

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 열기

## Vercel Deploy

1. GitHub에 `hwpx-report-automation/web` 폴더를 푸시
2. Vercel에서 프로젝트 Import
3. Environment Variables에 `OPENAI_API_KEY` 추가
4. Deploy

## Notes

- 편집은 XML 텍스트 노드만 바꾸므로 스타일 속성은 유지됩니다.
- HWPX 내부 XML 구조에 따라 일부 노드는 표시되지 않을 수 있습니다.
- 템플릿 카탈로그는 문서의 `{{...}}` 메타태그를 스캔해 필드 목록, 버전, 충돌 이슈를 계산합니다.

## Pass Criteria / Tests

1. Undo/Redo
- 기준: 큐 수정 후 `undo -> redo`에서 최종 편집 상태가 동일해야 함
- 테스트: `src/lib/editor-workflows.test.ts`

2. 섹션 자동 선택
- 기준: 현재 노드 기준으로 동일 파일 내 `헤딩 ~ 다음 헤딩 전` 범위를 선택해야 함
- 테스트: `src/lib/editor-workflows.test.ts`

3. HWPX 무결성(손상 방지)
- 기준: 편집 후에도 `mimetype`, `version.xml`, `Contents/content.hpf`가 유지되고 XML 파싱 가능해야 함
- 테스트: `src/lib/hwpx.test.ts`

실행:

```bash
npm run lint
npm run test
npm run build
```
