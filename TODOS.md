# TODOS

## i18n / 콘텐츠

### ISSUE-001: "Active tenant is required." 영문 오류 메시지 한국어 번역
**Priority:** P1
**Status:** Open
**Found by:** /qa on 2026-03-24 (health score 87/100)

**영향 페이지:** `/documents`, `/dashboard`, `/generate?templateId=<any>`

워크스페이스(테넌트) 미설정 상태에서 해당 페이지에 접근하면 "Active tenant is required." 영문 메시지가 노출됨. 나머지 UI는 한국어이므로 언어 불일치가 발생함.

**원인 파일 (2곳):**
- `src/lib/auth/with-api-auth.ts:45` — `"Active tenant is required."` 문자열 반환
- `src/lib/server/workspace-route-utils.ts:15` — `"Active tenant is required."` throw

**수정 방향:**
1. 위 두 파일의 영문 문자열을 `"워크스페이스 설정이 필요합니다."` 로 교체
2. (선택) 오류 메시지 하단에 워크스페이스 설정 페이지로 이동하는 CTA 버튼 추가

---

## UI / UX

### window.confirm → 모달 UI 교체
**Priority:** P2
**Status:** Open

`src/app/page.tsx` 에서 `window.confirm`을 2곳 (line 796, line 1066) 사용 중.
브라우저 기본 confirm 다이얼로그는 디자인 일관성이 없고, 일부 환경에서 차단될 수 있음.

**수정 방향:** 기존 UI 컴포넌트 체계(shadcn/ui 또는 자체 모달)를 활용한 확인 다이얼로그 컴포넌트로 교체.

---

### 모바일 / 반응형 CSS
**Priority:** P3
**Status:** Open

`src/app/page.tsx` 에 반응형 브레이크포인트가 없음. 에디터, 채팅 패널, 툴바 등 주요 레이아웃이 모바일에서 깨질 가능성이 높음.

**수정 방향:** Tailwind `sm:` / `md:` / `lg:` 브레이크포인트 적용. 최소 768px 미만 화면에서의 레이아웃 확인 필요.

---

## 임시저장 (Draft Cache)

### 임시저장 복원 배너 UX 검증
**Priority:** P2
**Status:** Needs Validation

`src/app/page.tsx` 에 localStorage 기반 30초 자동 임시저장 + 복원 배너가 구현되어 있음 (`DRAFT_CACHE_KEY = "hwpx_draft_cache"`).

**검증 항목:**
- 편집 후 30초 경과 → `localStorage`에 `hwpx_draft_cache` 저장 확인
- 탭 새로고침 후 복원 배너 노출 확인
- [복원] 버튼 클릭 시 TipTap JSON 내용 정상 복원 확인
- [무시] 버튼 클릭 시 캐시 삭제 확인
- workspace 저장 완료 후 캐시 자동 삭제 확인

---

## 테스트

### Pre-existing 테스트 실패 (19개 테스트 / 14개 파일)
**Priority:** P1 ← /plan-ceo-review 2026-03-25: 오픈소스 공개 전 필수 수정으로 격상
**Status:** ✅ Resolved — 95 test files, 614 passing, 0 failing (2026-03-25)
**Fixed by:** /plan-eng-review (Korean translation applied, dead code removed, rate limit bucketing fixed)

---

## Phase 2 — Discoverability Sprint (CEO 리뷰 2026-03-25 추가)

### GET /api/public/templates — 샘플 HWPX 파일 제공 엔드포인트
**Priority:** P1 (Phase 2 착수 시)
**Status:** Open
**Found by:** /plan-ceo-review SELECTIVE EXPANSION #2

커뮤니티 포스팅 예제에서 외부 개발자가 테스트용 .hwpx 파일을 직접 만들기 어려움.
`GET /api/public/templates` → 미니멀 샘플 HWPX 파일 목록 + 다운로드 URL 반환.

**구현 방향:**
- `public/samples/` 디렉토리에 `blank.hwpx`, `report-template.hwpx` 등 샘플 파일 추가
- `GET /api/public/templates` → `[{ name, description, url }]` JSON 반환
- Rate limit 필요 없음 (파일 크기 작음, 정적 자산)

**블로그 예시:**
```bash
# 1. 샘플 파일 받기
curl https://YOUR_DOMAIN/api/public/templates | jq '.[0].url' | xargs curl --output sample.hwpx
# 2. 바로 fill 테스트
curl -X POST https://YOUR_DOMAIN/api/public/fill -F "file=@sample.hwpx" -F 'data={"TITLE":"테스트"}' --output result.hwpx
```

**Effort:** S (~20분, CC+gstack) | **Priority:** P1 (Phase 2와 동시)

---

### GitHub Actions CI 파이프라인 + 테스트 실패 수정
**Priority:** P1 (오픈소스 공개 전 필수)
**Status:** Open
**Found by:** /plan-ceo-review SELECTIVE EXPANSION #3

19개 테스트 실패 상태로 GitHub에 오픈소스 공개 시 외부 기여자가 신뢰 손상.
CI 상태 배지가 🔴인 프로젝트는 스타를 누르지 않음.

**구현 방향:**
1. 19개 실패 테스트 수정 (블롭 다운로드 401 vs 403 불일치 포함)
2. `.github/workflows/ci.yml` 생성: `npm test` → vitest
3. README 상단에 `[![CI](badge_url)](action_url)` 배지 추가

**Effort:** S-M | **Blocks:** 오픈소스 공개, 커뮤니티 포스팅

---

### ZIP bomb / 대용량 XML 언패킹 방어
**Priority:** P1 (오픈소스 공개 전 필수)
**Status:** Open
**Found by:** /plan-ceo-review SELECTIVE EXPANSION #4 (보안)

HWPX = ZIP 컨테이너. 악의적인 사용자가 10MB 파일로 수백MB XML을 생성 가능.
`inspectHwpx`가 전체 XML을 메모리 파싱하면 Fly.io 단일 인스턴스 OOM 유발.

**구현 방향:**
- ZIP 파일 엔트리 언패킹 전 압축 해제 크기 합산: 50MB 초과 시 400 PAYLOAD_TOO_LARGE
- ZIP magic bytes 검증 (`PK\x03\x04` 시작 여부 체크)
- `src/lib/hwpx.ts` 또는 파서 레이어에 추가

**에러 응답:**
```json
{ "error": "PAYLOAD_TOO_LARGE", "message": "압축 해제된 파일 크기가 50MB를 초과합니다." }
```

**Effort:** S (~30분) | **Risk:** High (미처리 시)

---

### OpenAPI / Swagger 스펙 — /api/public/docs
**Priority:** P2 (Phase 3)
**Status:** Deferred
**Found by:** /plan-ceo-review SELECTIVE EXPANSION #1 (deferred)

`/api/public/*` 엔드포인트 자동 문서화. 외부 개발자가 화면에서 바로 try 가능.

**구현 방향:**
- `openapi.json` 정적 파일 + Swagger UI CDN으로 `/api/public/docs` 라우트
- 또는 `next-swagger-doc` 패키지 활용

**Effort:** S | **Priority:** P2 (Phase 3에서 처리)

---

## 10x Growth Sprint (CEO 리뷰 2026-03-25 SCOPE EXPANSION)

### hwpx-core.ts — MCP 서버 빌드를 위한 순수 Node.js 모듈 분리
**Priority:** P1 (MCP Server 구현 전 필수)
**Status:** Open
**Found by:** /plan-ceo-review SCOPE EXPANSION — Reviewer Concern #1

`mcp-server/`(`npx hwpx-mcp`)가 `web/src/lib/hwpx.ts`를 재사용하려면 Next.js 전용 import 여부 확인 필요. 없으면 상대 경로 참조로 해결; 있으면 `hwpx-core.ts`로 분리해야 번들링 가능.

**구현 방향:**
1. `grep -r "from 'next/" src/lib/hwpx.ts` 로 Next.js 의존성 체크
2. 의존성 없으면: `mcp-server/`에서 `../web/src/lib/hwpx.ts` 상대 경로 참조 + esbuild 번들
3. 의존성 있으면: `src/lib/hwpx-core.ts` 추출 (fill + inspect 순수 함수), 양쪽 import 수정

**Effort:** 0b 체크 S(5분) + 추출 필요 시 S(~1-2h) | **Blocks:** MCP Server 구현 착수

---

### rate limit NAT 대응 — /demo 바이럴 배포 전
**Priority:** P1 (배포 전 결정 필요)
**Status:** Open
**Found by:** /plan-ceo-review SCOPE EXPANSION — Reviewer Concern #2

/demo를 SNS에 공유하면 학교/회사 NAT 환경의 다수 사용자가 동일 IP로 접근 → 2 req/min으로 즉시 블록. 바이럴 목표와 충돌.

**구현 방향 옵션 (배포 전 결정):**
- A) `/demo` 전용 rate limit 분리: extract/fill 각각 5 req/min (낮은 abuse 리스크)
- B) 세션 기반 limit: 세션 토큰 발급 후 세션당 1회 허용 (복잡도 높음)
- C) 현행 유지 + UI에서 "같은 네트워크에서 여러 명이 사용 중이라면 잠시 후 시도" 안내

**Effort:** S | **Priority:** /demo 공개 전

---

### Playground /demo — 플레이스홀더 0개 상태 UI
**Priority:** P2
**Status:** Open
**Found by:** /plan-ceo-review SCOPE EXPANSION — Section 11 UX Review

플레이스홀더가 없는 HWPX 파일 선택 시 빈 폼이 그냥 렌더링됨. 사용자 입장에서 "고장났나?" 혼란.

**구현 방향:**
- extract 결과 count === 0 시: "이 템플릿에는 입력할 내용이 없어요. 직접 편집하려면 HWPX Studio↗" 안내 컴포넌트 표시
- 생성하기 버튼 비활성화 (플레이스홀더 없으면 결과물 의미 없음)

**Effort:** S(~20분) | 구현: Playground UI(/demo) 작업 시 함께 처리

---

### pyhwpx REST API 클라이언트 (client.py)
**Priority:** P3 (MCP 안정화 후 재검토)
**Status:** Deferred
**Found by:** /plan-ceo-review SCOPE EXPANSION — NOT in scope 결정

MCP Server와 기능 중복으로 이번 Phase에서 제외. MCP 생태계 안정화 후 "Python 환경에서 MCP 없이 REST API 쓰고 싶다" 수요 확인되면 추가.

**Effort:** S | **Depends on:** MCP 배포 후 사용자 피드백

---

## Completed

<!-- 완료된 항목은 여기에 이동하고 아래 형식으로 표시 -->
<!-- **Completed:** vX.Y.Z (YYYY-MM-DD) -->

### GET /api/public/templates
**Completed:** feat/chat-markdown-draft-fix (2026-03-25)
`/api/public/templates` 구현 완료. `public/samples/blank.hwpx`, `public/samples/report.hwpx` 추가.

### GitHub Actions CI + 테스트 수정
**Completed:** feat/chat-markdown-draft-fix (2026-03-25)
`.github/workflows/ci.yml` 생성, 테스트 3개 수정, README CI 배지 추가. ✅ Green

### ZIP bomb 방어
**Completed:** feat/chat-markdown-draft-fix (2026-03-25)
`validateZipSize()` + `ZipExpansionError` 구현. 50MB 초과 시 413 반환.

### 채팅 마크다운 렌더링
**Completed:** feat/chat-markdown-draft-fix (2026-03-24)

`src/components/sidebar/ChatPanel.tsx` 에 `react-markdown` 설치 및 어시스턴트 메시지에 ReactMarkdown 적용 완료. `**굵게**`, `*기울임*` 등 마크다운 문법이 정상 렌더링됨.

### 파일 재열기 버그 (race condition) 수정
**Completed:** feat/chat-markdown-draft-fix (2026-03-24)

`src/app/page.tsx` `onPickFile` 함수에서 `openStartWizard("upload")` 호출 제거. 파일 선택 시 `clearWorkspaceContext()` → `loadFileIntoEditor()` 순서로 정상 동작.

### Public API — `/api/public/fill` & `/api/public/extract`
**Completed:** PR #67 merged (2026-03-24)

두 엔드포인트 모두 /qa에서 정상 동작 확인:
- `POST /api/public/fill` → 200 OK, HWPX 반환
- `POST /api/public/extract` → 200 OK, 텍스트 노드 반환
- Rate limit (2 req/min per IP) 정상 동작 확인
