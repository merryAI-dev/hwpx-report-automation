# hwpx-report-automation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**AI가 작성한 내용을 HWPX(한글 오피스) 템플릿에 자동으로 채워넣는 도구 — 복사붙여넣기 없이, 서식 깨짐 없이.**

> English: [English README](README.md)

---

## 왜 만들었나요?

한국에서 공문서, 제안서, 회의록 대부분은 한글(.hwpx) 형식으로 작성됩니다. 하지만 `.hwpx` 파일을 코드로 편집할 수 있는 공개 API는 없습니다.

이 프로젝트는 HWPX의 실체에서 출발합니다: **HWPX는 XML 파일들을 담은 ZIP 아카이브입니다.** ZIP을 열고, 건드려야 할 텍스트 노드만 찾아서 교체하고, 다시 압축합니다 — 폰트, 단락 스타일, 레이아웃은 전혀 손대지 않습니다.

---

## 주요 기능

- **템플릿 플레이스홀더 치환** — `.hwpx` 파일에 `{{TITLE}}`, `{{CONTENT}}` 등을 표시해두고 JSON으로 채우기
- **AI 보고서 자동 생성** — OpenAI / Anthropic API로 보고서 내용 자동 생성
- **스타일 안전 편집** — 텍스트만 교체, 폰트·단락 스타일·레이아웃 속성은 보존
- **HWPX 무결성 검증** — ZIP 구조, mime 타입, XML 유효성 검사
- **웹 UI** — Next.js 기반 편집기 (배치 처리, AI 제안, 문서 관리)

---

## 빠른 시작

### Python (템플릿 채우기)

기본 기능은 표준 라이브러리만으로 동작합니다.

```bash
# 1. 데이터 파일 작성
cat > data.json << 'EOF'
{
  "TITLE": "2025년 연간 보고서",
  "SUMMARY": "1~4분기 주요 내용입니다.",
  "AUTHOR": "홍길동"
}
EOF

# 2. 템플릿에 플레이스홀더 채우기
python scripts/fill_hwpx_template.py \
  --template template.hwpx \
  --data-json data.json \
  --output output.hwpx
```

### Python (텍스트 노드 검사 / 직접 편집)

```bash
# HWPX 파일의 모든 텍스트 노드 목록 출력
python scripts/hwpx_editor.py --input report.hwpx --list

# 인덱스 기반으로 특정 노드 직접 편집
python scripts/hwpx_editor.py \
  --input report.hwpx \
  --edits-json edits.json \
  --output report_edited.hwpx
```

### 웹 UI

```bash
cd web
cp .env.example .env.local   # API 키 입력
npm install
npm run dev
# → http://localhost:3000
```

---

## 프로젝트 구조

```
scripts/
  fill_hwpx_template.py   플레이스홀더 치환 ({{KEY}} → 값)
  hwpx_editor.py          텍스트 노드 검사 및 편집 (저수준)
  build_report.py         AI 기반 보고서 생성 파이프라인
  hancom-verify/          HWPX 무결성 검증 도구

web/                      Next.js 웹 앱
  src/app/                페이지 및 API 라우트
  src/lib/                비즈니스 로직 (HWPX 처리, AI 연동)
  prisma/                 데이터베이스 스키마 (SQLite / LibSQL)
```

---

## 설계 철학

HWPX는 ZIP 파일입니다. 그 안의 XML에 모든 단락, 텍스트 런, 스타일 정보가 담겨 있습니다.

대부분의 도구는 문서 전체를 재직렬화하여 스타일이 깨지거나 메타데이터가 손실됩니다. 우리는 다릅니다:

1. HWPX ZIP을 **열고**
2. 바꿔야 할 XML 텍스트 노드만 **찾아서**
3. 텍스트 내용만 **교체하고** (다른 건 전혀 건드리지 않음)
4. 원래 파일 메타데이터를 유지하며 ZIP을 **다시 압축합니다**

출력 `.hwpx` 파일은 바꾼 텍스트 부분을 제외하면 원본과 바이트 수준에서 동일합니다.

---

## 요구사항

| 구성 요소 | 요구사항 |
|-----------|----------|
| Python 스크립트 | Python 3.8 이상 |
| 웹 UI | Node.js 18 이상, npm |
| AI 기능 | OpenAI 또는 Anthropic API 키 |
| 데이터베이스 | SQLite (Prisma로 자동 생성) |

```bash
pip install requests   # build_report.py (AI 생성) 사용 시만 필요
```

---

## 기여하기

이슈와 PR 모두 환영합니다. 큰 변경사항은 먼저 이슈로 방향을 논의해주세요.

---

## 라이선스

[MIT](LICENSE) © 2025 MYSC
