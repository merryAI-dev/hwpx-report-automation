# Contributing to hwpx-studio

한국어로 된 안내를 원하시면 아래 내용을 참고해주세요.
English instructions are also available below.

---

## 환영합니다! Welcome!

**hwpx-studio**는 NGO, 비영리기관, 공공기관이 HWPX 문서를 자동화할 수 있도록 돕는 오픈소스 프로젝트입니다.

기여는 언제나 환영해요. 버그 리포트, 기능 제안, 코드 기여, 문서 개선 — 모두 소중한 기여입니다.

> hwpx-studio is an open-source project helping NGOs and public organizations automate HWPX documents.
> All contributions are welcome — bug reports, feature requests, code, and documentation.

---

## 로컬 개발 환경 설정 (Local Setup)

### Prerequisites

- **Node.js** 20 이상 (`node --version`으로 확인)
- **Python** 3.10 이상 (`python --version`으로 확인)
- **pyhwpx** — Python HWPX 처리 라이브러리

```bash
pip install pyhwpx
```

### 설치 및 실행

```bash
# 1. 저장소 클론
git clone https://github.com/merryAI-dev/hwpx-report-automation.git
cd hwpx-report-automation

# 2. 의존성 설치
npm install

# 3. 환경변수 설정
cp .env.example .env
# .env 파일을 열어 필요한 값 확인 (로컬 개발은 기본값으로 바로 사용 가능)

# 4. 데이터베이스 초기화
npx prisma db push

# 5. 개발 서버 실행
npm run dev
```

브라우저에서 `http://localhost:3000` 으로 접속하면 됩니다.

---

## 환경변수 안내 (Environment Variables)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `AUTH_DISABLED` | `true` | `true`이면 단일 사용자 모드 (로컬 개발용). 로그인 없이 바로 사용 가능. |
| `DATABASE_URL` | `file:./dev.db` | SQLite (로컬) 또는 PostgreSQL URL (프로덕션). |

**주의사항:**

- `AUTH_DISABLED=false`로 설정할 경우, session secret 관련 추가 환경변수가 필요합니다.
- 프로덕션 배포 시 `DATABASE_URL`을 PostgreSQL URL로 교체하세요. (예: `postgresql://user:pass@host:5432/dbname`)
- **API 키나 시크릿은 절대 코드에 직접 넣지 마세요.** `.env` 파일에 넣고, `.gitignore`에 포함되어 있는지 반드시 확인하세요.

---

## PR 프로세스 (Pull Request Process)

### 브랜치 전략

```
main            ← 프로덕션 브랜치
  └── feature/기능명     ← 기능 개발
  └── fix/버그명         ← 버그 수정
  └── docs/문서명        ← 문서 작업
```

### 단계별 흐름

1. `main`에서 새 브랜치를 만들어요.
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. 변경 사항을 커밋해요. (커밋 컨벤션 아래 참고)
3. PR을 생성하고 변경 내용을 설명해주세요.
4. CI가 통과되어야 리뷰가 진행돼요.
5. 리뷰어의 피드백을 반영한 후 머지됩니다.

### 커밋 컨벤션

```
feat:     새로운 기능 추가
fix:      버그 수정
refactor: 코드 리팩토링 (기능 변경 없음)
docs:     문서 수정
chore:    빌드, 설정 등 기타 변경
test:     테스트 코드 추가/수정
```

예시:
```
feat: HWPX 템플릿 일괄 생성 API 추가
fix: 문서 업로드 시 한글 파일명 깨지는 문제 수정
docs: CONTRIBUTING.md 로컬 설정 안내 보완
```

---

## 주요 폴더 구조 (Project Structure)

```
hwpx-report-automation/
├── src/app/api/        # Next.js API 라우트 (문서 생성, 업로드, 배치 작업 등)
├── prisma/             # Prisma DB 스키마 및 마이그레이션
├── mcp-server/         # Claude / Cursor MCP 서버 (AI 연동)
├── pyhwpx/             # Python HWPX 처리 라이브러리
├── scripts/            # 유틸리티 스크립트 (검증, 회귀 테스트 등)
└── public/             # 정적 파일
```

---

## 이슈 가이드 (Issue Guidelines)

### 버그 리포트

버그를 발견하셨다면 아래 형식으로 이슈를 작성해주세요:

```
**환경 (Environment)**
- OS: (예: macOS 14, Ubuntu 22.04)
- Node.js 버전:
- Python 버전:
- pyhwpx 버전:

**재현 방법 (Steps to Reproduce)**
1. ...
2. ...
3. ...

**기대 결과 (Expected Behavior)**
...

**실제 결과 (Actual Behavior)**
...

**스크린샷 / 로그 (Screenshots / Logs)**
(가능하면 첨부해주세요)
```

### 기능 요청

새 기능을 제안하실 때는 아래 형식을 사용해주세요:

```
**배경 (Background)**
어떤 문제를 해결하려고 하는지 설명해주세요.

**제안 기능 (Proposed Feature)**
어떤 기능이 있으면 좋겠는지 설명해주세요.

**기대 효과 (Expected Impact)**
이 기능이 어떤 사용자에게, 어떻게 도움이 될지 알려주세요.
```

---

## 라이선스 (License)

이 프로젝트에 기여하면 해당 기여가 프로젝트의 라이선스 조건 하에 배포되는 것에 동의하는 것으로 간주됩니다.

By contributing, you agree that your contributions will be licensed under the project's license.
