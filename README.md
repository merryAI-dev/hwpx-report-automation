# hwpx-report-automation

[![CI](https://github.com/merryAI-dev/hwpx-report-automation/actions/workflows/ci.yml/badge.svg)](https://github.com/merryAI-dev/hwpx-report-automation/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/)
[![Node.js 18+](https://img.shields.io/badge/node-18+-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/merryAI-dev/hwpx-report-automation/issues)

**🌐 언어:** [English](README-en.md) | [한국어](#)

---

AI 기반 보고서 자동 생성을 위한 HWPX 문서 자동화 시스템.

HWPX 편집 API가 없다고요? 괜찮습니다. **HWPX는 ZIP 파일입니다.** 열고, 필요한 부분만 바꾸고, 닫으면 됩니다 — 서식 그대로, 손상 없이.

> [MYSC](https://mysc.kr)에서 실제 보고서 자동화를 위해 만들었습니다. 공공 제안서, 투자 검토 메모, 회의록에서 검증됐습니다.

---

## 목차

- [이게 뭔가요?](#이게-뭔가요)
- [구성](#구성)
- [빠른 시작](#빠른-시작)
  - [템플릿 채우기 (Python 스크립트)](#템플릿-채우기-python-의존성-없음)
  - [텍스트 노드 검사 및 직접 편집](#텍스트-노드-검사-및-직접-편집-python)
  - [AI 보고서 생성](#ai-보고서-생성-python--openaianthropic)
  - [pyhwpx — Python 패키지](#pyhwpx--python-패키지-pip)
  - [MCP 서버 — Claude / Cursor 연동](#mcp-서버--claude--cursor-연동)
  - [플레이그라운드 — 브라우저에서 바로 체험](#플레이그라운드--브라우저에서-바로-체험-인증-불필요)
  - [HWPX Studio — 웹 UI](#hwpx-studio--웹-ui-nextjs)
- [배포](#배포)
- [환경 변수](#환경-변수)
- [상황별 도구 선택](#상황별-도구-선택)
- [공개 REST API](#공개-rest-api)
- [설계 철학](#설계-철학)
- [요구사항](#요구사항)
- [활용 사례](#활용-사례)
- [기여하기](#기여하기)
- [자주 묻는 질문](#자주-묻는-질문)
- [배경](#배경)
- [라이선스](#라이선스)

---

## 이게 뭔가요?

한글(HWP/HWPX)은 한국의 지배적인 문서 포맷입니다 — 사실상 모든 정부 기관, 공공기관, 기업에서 사용됩니다. 하지만 `.hwpx` 파일을 코드로 편집할 수 있는 **공개 API는 존재하지 않습니다.**

기존 우회책들은 모두 문제가 있습니다:

| 방법 | 문제점 |
|------|--------|
| 한글 오피스 COM 자동화 | 라이선스 필요, Windows 전용, 서버 환경 불가 |
| XML 전체 재직렬화 | 한글 전용 스타일 참조 파괴, 임베디드 폰트 유실 |
| DOCX 변환 후 편집 | 원본 서식 완전 파괴, 역변환 불가 |
| 상용 라이브러리 | 비용 발생, 폐쇄 소스, 서버 환경 제약 |

이 프로젝트는 다릅니다. HWPX의 실체에서 출발합니다 — **XML 파일들을 담은 ZIP 아카이브** — 그리고 지정한 텍스트 노드만 정밀하게 교체합니다. 나머지는 바이트 수준까지 그대로입니다.

```
template.hwpx  →  fill_hwpx_template.py  →  output.hwpx
                        ↑
                  {"TITLE": "2025 연간 보고서",
                   "AUTHOR": "홍길동"}
```

### HWPX 내부 구조

HWPX 파일을 `unzip`으로 열어보면 다음과 같은 구조가 나타납니다:

```
document.hwpx (실제로는 ZIP)
├── mimetype                      # "application/hwp+zip"
├── META-INF/
│   └── container.xml
├── Contents/
│   ├── content.hpf               # 패키지 루트 (OPF)
│   ├── header.xml                # 문서 속성, 스타일, 폰트 정의
│   ├── section0.xml              # 본문 (1번째 섹션)
│   ├── section1.xml              # 본문 (2번째 섹션, 있을 경우)
│   └── ...
└── BinData/
    ├── image1.png                # 임베디드 이미지 (바이너리, 건드리지 않음)
    └── ...
```

이 프로젝트는 `section*.xml` 파일 안의 `<hp:t>` 요소 텍스트만 교체합니다. 이미지, 폰트, 스타일 등 나머지는 바이트 단위로 원본을 그대로 유지합니다.

---

## 구성

```
hwpx-report-automation/
│
├── scripts/                        Python CLI 스크립트 (의존성 없음)
│   ├── fill_hwpx_template.py       템플릿 플레이스홀더 치환 ({{KEY}} → 값)
│   ├── hwpx_editor.py              텍스트 노드 검사 및 저수준 편집
│   ├── build_report.py             AI 기반 보고서 생성 파이프라인
│   └── hancom-verify/              HWPX 무결성 검증 (Swift/macOS 전용)
│
├── mcp-server/                     MCP 서버 (Claude / Cursor 자연어 연동)
│   ├── src/                        TypeScript 소스
│   ├── dist/index.js               번들된 ESM (esbuild)
│   └── package.json                hwpx-mcp v1.0.0
│
├── pyhwpx/                         순수 Python 패키지 (stdlib 전용)
│   ├── pyhwpx/
│   │   ├── __init__.py             fill_template, extract_nodes 노출
│   │   └── core.py                 zipfile + xml.etree.ElementTree 구현
│   └── pyproject.toml
│
└── web/                            Next.js 웹 애플리케이션 (HWPX Studio)
    ├── src/
    │   ├── app/                    App Router 페이지 및 API 라우트 (64개)
    │   │   ├── (auth)/             로그인, 회원가입, OIDC 콜백
    │   │   ├── api/
    │   │   │   ├── public/         인증 불필요 공개 API
    │   │   │   │   ├── health/     GET  — 헬스체크
    │   │   │   │   ├── extract/    POST — 텍스트 노드 추출
    │   │   │   │   ├── fill/       POST — 플레이스홀더 치환
    │   │   │   │   ├── templates/  GET  — 내장 템플릿 목록
    │   │   │   │   ├── docs/       GET  — OpenAPI 3.0.3 스펙
    │   │   │   │   └── docs/ui/    GET  — Swagger UI
    │   │   │   └── ...             인증 필요 API (문서, 편집, AI 등)
    │   │   └── demo/               플레이그라운드 (인증 불필요)
    │   ├── lib/                    비즈니스 로직
    │   │   ├── hwpx/               HWPX 처리 (노드 추출, 치환, 무결성 검사)
    │   │   ├── ai/                 Anthropic/OpenAI/Gemini 연동
    │   │   ├── auth/               세션 관리, OIDC
    │   │   └── blob/               파일 스토리지 (FS / S3)
    │   └── components/             React 컴포넌트
    ├── prisma/
    │   └── schema.prisma           SQLite 스키마 (users, documents, templates)
    ├── fly.toml                    Fly.io 배포 설정
    └── Dockerfile                  Docker 이미지
```

---

## 빠른 시작

### 템플릿 채우기 (Python, 의존성 없음)

가장 간단한 사용 방법입니다. Python 표준 라이브러리만 사용하므로 별도 설치가 필요 없습니다.

**1단계: 한글 오피스에서 템플릿 준비**

한글 오피스에서 `.hwpx` 파일을 열고, 자동화하고 싶은 위치에 `{{KEY}}` 형식으로 입력합니다. 일반 텍스트처럼 타이핑하면 됩니다.

```
예: 제목 셀에 {{TITLE}} 입력
    작성자 란에 {{AUTHOR}} 입력
    날짜 란에 {{DATE}} 입력
```

**2단계: 데이터 파일 작성**

```bash
cat > data.json << 'EOF'
{
  "TITLE": "2025 연간 보고서",
  "SUMMARY": "1~4분기 주요 성과 및 재무 현황입니다.",
  "AUTHOR": "홍길동",
  "DATE": "2025년 12월 31일",
  "DEPARTMENT": "전략기획팀"
}
EOF
```

**3단계: 실행**

```bash
python scripts/fill_hwpx_template.py \
  --template template.hwpx \
  --data-json data.json \
  --output output.hwpx
```

```
✓ Replaced 5 placeholder(s)
✓ Created: output.hwpx
```

**주의사항:**
- 키 이름은 대소문자를 구분하지 않습니다. `{"title": "..."}` 는 `{{TITLE}}`과 매칭됩니다.
- 플레이스홀더 형식: `{{KEY}}` — 키는 영문자, 숫자, 언더스코어(`_`)만 허용
- 값에 포함된 XML 특수문자(`<`, `>`, `&`)는 자동으로 이스케이프됩니다.
- 같은 키가 여러 곳에 있으면 모두 치환됩니다.

한글 오피스 불필요. COM 자동화 불필요. Docker 불필요. Python 표준 라이브러리(`zipfile`, `xml.etree.ElementTree`)만으로 동작합니다.

---

### 텍스트 노드 검사 및 직접 편집 (Python)

플레이스홀더 없이 HWPX 파일을 직접 수정해야 할 때 사용합니다. 모든 텍스트 노드를 인덱스로 식별하고 원하는 노드만 교체할 수 있습니다.

**모든 텍스트 노드 목록 출력:**

```bash
python scripts/hwpx_editor.py --input report.hwpx --list
```

출력 예시:

```json
[
  {
    "file_name": "Contents/section0.xml",
    "text_index": 0,
    "text": "2024 연간 사업 보고서",
    "bold": true,
    "font_size": 22
  },
  {
    "file_name": "Contents/section0.xml",
    "text_index": 1,
    "text": "작성일: 2024.12.31",
    "bold": false,
    "font_size": 10
  },
  {
    "file_name": "Contents/section0.xml",
    "text_index": 2,
    "text": "1. 사업 개요",
    "bold": true,
    "font_size": 14
  }
]
```

**인덱스 기반으로 노드 편집:**

```bash
# edits.json 작성: 어떤 파일의 몇 번째 노드를 무엇으로 바꿀지
cat > edits.json << 'EOF'
[
  {
    "file_name": "Contents/section0.xml",
    "text_index": 0,
    "new_text": "2025 연간 사업 보고서"
  },
  {
    "file_name": "Contents/section0.xml",
    "text_index": 1,
    "new_text": "작성일: 2025.12.31"
  }
]
EOF

python scripts/hwpx_editor.py \
  --input report.hwpx \
  --edits-json edits.json \
  --output report_edited.hwpx
```

```
✓ Applied 2 edit(s)
✓ Created: report_edited.hwpx
```

`hwpx_editor.py`는 머리글, 바닥글, 표 안의 텍스트를 포함한 **모든 섹션**의 노드를 다룹니다. `--list`로 인덱스를 확인한 후 `--edits-json`으로 정밀 편집하세요.

---

### AI 보고서 생성 (Python + OpenAI/Anthropic)

LLM이 보고서 내용을 생성하고, 결과를 HWPX 템플릿에 자동으로 채워 넣습니다.

```bash
pip install requests

export OPENAI_API_KEY=sk-...
# 또는
export ANTHROPIC_API_KEY=sk-ant-...

python scripts/build_report.py \
  --template template.hwpx \
  --prompt "SaaS 기업의 2025년 3분기 사업 검토 보고서를 작성해줘. 핵심 지표, 주요 성과, 다음 분기 계획을 포함해줘." \
  --output report_q3.hwpx
```

동작 방식:
1. `--list` 옵션으로 템플릿의 텍스트 노드 구조 파악
2. LLM에게 "이 구조에 맞게 내용을 채워줘" 요청
3. LLM 응답을 파싱해서 각 노드에 적용
4. 완성된 HWPX 저장

---

### pyhwpx — Python 패키지 (pip)

`scripts/` 폴더 없이 Python 코드에서 직접 임포트해서 사용할 수 있는 패키지입니다. 표준 라이브러리만 사용하므로 별도 의존성이 없습니다.

**설치:**

```bash
pip install pyhwpx
```

**`fill_template` — 플레이스홀더 치환:**

```python
from pyhwpx import fill_template

# 기본 사용법
count = fill_template(
    input_path="template.hwpx",
    placeholders={"TITLE": "2026 보고서", "AUTHOR": "홍길동"},
    output_path="output.hwpx",
)
print(f"총 {count}개 플레이스홀더 치환 완료")
# → 총 2개 플레이스홀더 치환 완료
```

- `count` — 실제로 치환된 `{{PLACEHOLDER}}` 개수를 반환합니다.
- 키는 자동으로 대문자 변환됩니다: `{"title": "..."}` → `{{TITLE}}` 매칭
- 값의 XML 특수문자는 자동 이스케이프됩니다.
- `input_path`와 `output_path`가 같으면 인플레이스 편집입니다.

**`extract_nodes` — 텍스트 노드 추출:**

```python
from pyhwpx import extract_nodes

nodes = extract_nodes("document.hwpx")

for node in nodes:
    print(f"[{node['file_name']} #{node['text_index']}] {node['text']}")
# → [Contents/section0.xml #0] 2024 연간 사업 보고서
# → [Contents/section0.xml #1] 작성일: 2024.12.31
# → [Contents/section0.xml #2] 1. 사업 개요
```

반환 타입: `list[{"file_name": str, "text_index": int, "text": str}]`

**파이프라인 통합 예시:**

```python
from pyhwpx import fill_template, extract_nodes
import json

# 1. 기존 문서 구조 파악
nodes = extract_nodes("template.hwpx")
placeholders = [n["text"] for n in nodes if n["text"].startswith("{{")]
print("필요한 데이터:", placeholders)

# 2. 외부 시스템에서 데이터 가져오기 (예: DB, API)
data = fetch_report_data_from_db()

# 3. 채우고 저장
count = fill_template("template.hwpx", data, "output.hwpx")
print(f"{count}개 항목 완성")
```

**pip 없이 사용하기:**

`pyhwpx/` 디렉터리를 프로젝트에 복사하면 pip 없이도 임포트할 수 있습니다:

```python
import sys
sys.path.insert(0, "/path/to/hwpx-report-automation")
from pyhwpx import fill_template
```

---

### MCP 서버 — Claude / Cursor 연동

Claude Desktop이나 Cursor에서 HWPX 작업을 자연어로 처리할 수 있는 MCP(Model Context Protocol) 서버입니다.

**빌드 (최초 1회):**

```bash
cd mcp-server
npm install
npm run build
# → dist/index.js 생성
```

**Claude Desktop 설정:**

macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hwpx": {
      "command": "node",
      "args": ["/절대경로/hwpx-report-automation/mcp-server/dist/index.js"]
    }
  }
}
```

설정 후 Claude Desktop을 재시작하면 적용됩니다.

**Cursor 설정:**

`.cursor/mcp.json` (프로젝트별) 또는 `~/.cursor/mcp.json` (전역):

```json
{
  "mcpServers": {
    "hwpx": {
      "command": "node",
      "args": ["/절대경로/hwpx-report-automation/mcp-server/dist/index.js"]
    }
  }
}
```

**제공 도구:**

| 도구 | 설명 | 입력 |
|------|------|------|
| `fill_hwpx` | HWPX 템플릿 플레이스홀더 치환 | `template_path`, `data` (JSON 객체), `output_path` |
| `extract_placeholders` | HWPX에서 `{{PLACEHOLDER}}` 키 목록 추출 | `file_path` |
| `list_templates` | 서버에 등록된 HWPX 템플릿 목록 조회 | (없음) |

**사용 예시 (Claude에서):**

```
사용자: "template.hwpx 파일에 어떤 플레이스홀더가 있어?"
Claude: extract_placeholders 도구를 호출합니다...
       → ["TITLE", "AUTHOR", "DATE", "SUMMARY"]

사용자: "TITLE은 '2026 전략 보고서', AUTHOR는 '김철수'로 채워줘"
Claude: fill_hwpx 도구를 호출합니다...
       → 2개 플레이스홀더 치환 완료, output.hwpx 저장됨
```

---

### 플레이그라운드 — 브라우저에서 바로 체험 (인증 불필요)

회원가입·로그인 없이 HWPX 기능을 즉시 체험할 수 있는 데모 페이지입니다. 처음 방문자, 기술 평가자, 팀 내 시연용으로 적합합니다.

**접속:**

```
http://localhost:3000/demo      # 로컬 개발 서버
https://YOUR_DOMAIN/demo        # 배포된 인스턴스
```

**사용 흐름:**

```
1. 템플릿 선택
   └─ 서버에 내장된 샘플 템플릿 목록에서 선택
      (또는 나중에 자신의 .hwpx 파일 업로드 예정)

2. 플레이스홀더 자동 감지
   └─ 선택한 템플릿의 {{PLACEHOLDER}} 키를 자동으로 읽어서
      각 키마다 입력 필드 생성

3. 값 입력
   └─ 폼에 내용을 채운 후 "생성하기" 클릭

4. 다운로드
   └─ 완성된 output.hwpx 파일 즉시 다운로드
      → 한글 오피스에서 바로 열 수 있음
```

**특징:**
- 인증 불필요 — 계정 생성 없이 바로 사용
- 생성된 파일은 서버에 저장되지 않음 (일회성 처리)
- 모바일 브라우저에서도 동작

---

### HWPX Studio — 웹 UI (Next.js)

브라우저에서 바로 쓰는 풀스택 HWPX 편집기입니다. Vercel 또는 Fly.io에 배포해서 팀 전체가 공유할 수 있습니다.

**주요 기능:**

| 기능 | 설명 |
|------|------|
| HWPX 업로드 및 편집 | 파일 업로드 후 텍스트 노드를 브라우저에서 직접 탐색·편집 |
| 구형 `.hwp` 지원 | 외부 변환기(`HWP_CONVERTER_COMMAND`) 연동 |
| AI 채팅 사이드바 | Anthropic / OpenAI / Google Gemini BYOK, 마크다운 렌더링 |
| PPTX → HWPX 마법사 | PPT 업로드 → 내용 분석 → 보고서 구조 생성 → HWPX 내보내기 |
| 플레이스홀더 치환 | `{{PLACEHOLDER}}` 일괄 치환, 미리보기 |
| 배치 문서 생성 | CSV 데이터로 동일 템플릿 수백 건 일괄 생성 |
| 문서함·대시보드 | Notion 스타일 문서 관리, 폴더 구성 |
| 로컬 임시저장 | 30초마다 localStorage 자동 저장, 재방문 시 복원 배너 |
| HWPX 무결성 검사 | `mimetype`, `version.xml`, XML 유효성 검증 |
| 사용자·쿼터 관리 | 다중 사용자, 테넌트별 문서/템플릿 수 제한 |

**로컬 실행:**

```bash
cd web
cp .env.example .env.local   # 환경 변수 설정 (아래 "환경 변수" 섹션 참고)
npm install
npm run dev
# → http://localhost:3000
```

**테스트 실행:**

```bash
npm run lint          # ESLint
npm run test          # vitest (유닛 + 통합 테스트)
npm run build         # 프로덕션 빌드 확인
```

---

## 배포

### Fly.io (권장 — 파일 스토리지 포함)

Persistent volume이 지원되므로 업로드된 HWPX 파일이 재시작 후에도 유지됩니다.

```bash
cd web

# 1. Fly.io CLI 로그인
fly auth login

# 2. 앱 초기화 (fly.toml 이미 포함됨, 재생성 불필요)
fly launch --no-deploy

# 3. 시크릿 설정
fly secrets set \
  NEXTAUTH_SECRET="$(openssl rand -base64 32)" \
  ANTHROPIC_API_KEY="sk-ant-..." \
  OPENAI_API_KEY="sk-..."          \
  BLOB_SIGNING_SECRET="$(openssl rand -base64 32)"

# 4. Persistent Volume 생성 (파일 스토리지)
fly volumes create hwpx_data --region nrt --size 1   # 1GB, 도쿄 리전

# 5. 배포
fly deploy
```

기본 설정 (`fly.toml`):
- 리전: `nrt` (도쿄) — 한국에서 가장 가까운 리전
- 파일 스토리지: `/data/blob-storage` (Persistent Volume 마운트)
- `auto_stop_machines = "off"` — 콜드 스타트 없이 항상 실행

### Vercel (서버리스 — 파일 스토리지 없음)

Persistent filesystem이 없으므로 파일 스토리지를 S3로 구성해야 합니다.

```bash
# 1. GitHub에 레포지토리 push
# 2. Vercel Dashboard에서 web/ 디렉터리를 루트로 임포트
# 3. Environment Variables 추가:
#    NEXTAUTH_SECRET=...
#    ANTHROPIC_API_KEY=...
#    BLOB_STORAGE_DRIVER=s3
#    BLOB_STORAGE_S3_BUCKET=...
#    BLOB_STORAGE_S3_REGION=ap-northeast-2
#    BLOB_STORAGE_S3_ACCESS_KEY_ID=...
#    BLOB_STORAGE_S3_SECRET_ACCESS_KEY=...
```

> **주의:** Vercel 서버리스 환경에서는 로컬 파일 시스템에 쓸 수 없습니다. `BLOB_STORAGE_DRIVER=s3`를 반드시 설정하세요.

### Docker (셀프 호스팅)

```bash
cd web
docker build -t hwpx-studio .
docker run -p 3000:3000 \
  -e NEXTAUTH_SECRET="your-secret" \
  -e ANTHROPIC_API_KEY="sk-ant-..." \
  -v /host/data:/data/blob-storage \
  hwpx-studio
```

---

## 환경 변수

`web/.env.example`을 복사해서 `web/.env.local`로 사용합니다.

### 필수

| 변수 | 설명 | 예시 |
|------|------|------|
| `NEXTAUTH_SECRET` | 세션 서명용 비밀키 (32자 이상 랜덤 문자열) | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | 앱의 공개 URL (프로덕션 시 필수) | `https://hwpx.example.com` |

AI 키는 최소 하나 이상 필요합니다:

| 변수 | 설명 |
|------|------|
| `ANTHROPIC_API_KEY` | Claude API 키 (AI 채팅 사이드바) |
| `OPENAI_API_KEY` | OpenAI API 키 |

### 선택 — AI 모델 오버라이드

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | 사용할 Claude 모델 |
| `OPENAI_MODEL` | `gpt-4.1-mini` | 사용할 OpenAI 모델 |

### 선택 — 파일 스토리지

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `BLOB_STORAGE_DRIVER` | `fs` | `fs` (로컬 파일) 또는 `s3` |
| `BLOB_STORAGE_FS_ROOT` | `.blob-storage` | `fs` 드라이버용 저장 경로 |
| `BLOB_STORAGE_S3_BUCKET` | — | S3 버킷 이름 |
| `BLOB_STORAGE_S3_REGION` | `ap-northeast-2` | S3 리전 |
| `BLOB_STORAGE_S3_ACCESS_KEY_ID` | — | AWS 액세스 키 |
| `BLOB_STORAGE_S3_SECRET_ACCESS_KEY` | — | AWS 시크릿 키 |
| `BLOB_STORAGE_S3_ENDPOINT` | — | S3 호환 스토리지 엔드포인트 (MinIO 등) |
| `BLOB_SIGNING_SECRET` | — | 파일 다운로드 URL 서명 비밀키 |

### 선택 — 쿼터 및 기타

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `QUOTA_MAX_DOCUMENTS` | `100` | 사용자당 최대 문서 수 |
| `QUOTA_MAX_TEMPLATES` | `20` | 사용자당 최대 템플릿 수 |
| `QUOTA_MAX_BLOB_BYTES` | `5368709120` | 사용자당 최대 저장 용량 (5 GB) |
| `HWP_CONVERTER_COMMAND` | — | 구형 `.hwp` 변환기 명령어 (예: `["node","converter.js","{input}","{output}"]`) |
| `PORT` | `3000` | HTTP 포트 |

---

## 상황별 도구 선택

| 하고 싶은 것 | 도구 | 명령어/방법 |
|-------------|------|------------|
| 템플릿 한 번 채우기 | Python 스크립트 | `python scripts/fill_hwpx_template.py` |
| HWPX 내부 구조 확인 | Python 스크립트 | `python scripts/hwpx_editor.py --list` |
| AI로 보고서 내용 생성 | Python 스크립트 | `python scripts/build_report.py` |
| Python 코드에서 임포트 | pyhwpx 패키지 | `pip install pyhwpx` |
| Claude / Cursor에서 자연어로 | MCP 서버 | `mcp-server/dist/index.js` |
| 브라우저에서 즉시 체험 | 플레이그라운드 | `http://localhost:3000/demo` |
| 문서 대량 생성·팀 공유 | HWPX Studio | `npm run dev` → http://localhost:3000 |
| HWPX 파일 무결성 검증 | hancom-verify | `scripts/hancom-verify/` 참고 |
| HTTP REST API로 시스템 연동 | 공개 REST API | `/api/public/*` (아래 참고) |

---

## 공개 REST API

인증 없이 사용할 수 있는 공개 API 엔드포인트입니다.

**공통 사항:**
- Rate limit: **IP당 엔드포인트별 2 req/min**
- 최대 파일 크기: **10 MB**
- 응답 형식: JSON (파일 다운로드는 `application/octet-stream`)
- CORS: 모든 오리진 허용 (`Access-Control-Allow-Origin: *`)

**공통 에러 응답:**

```json
// 429 Too Many Requests
{"error": "Rate limit exceeded. Try again in 60 seconds."}

// 400 Bad Request
{"error": "Missing required field: file"}

// 413 Payload Too Large
{"error": "File too large. Maximum size is 10 MB."}
```

---

### `GET /api/public/health`

서버 상태를 확인합니다. 배포 후 헬스체크, 업타임 모니터링에 사용합니다.

```bash
curl https://YOUR_DOMAIN/api/public/health
```

응답 `200 OK`:
```json
{
  "status": "ok",
  "ts": "2025-01-15T09:00:00.000Z"
}
```

---

### `POST /api/public/extract`

HWPX 파일의 모든 텍스트 노드를 JSON으로 추출합니다. 어떤 플레이스홀더가 있는지 확인하거나, 내용을 분석할 때 사용합니다.

```bash
curl -X POST https://YOUR_DOMAIN/api/public/extract \
  -F "file=@document.hwpx"
```

응답 `200 OK`:
```json
{
  "nodes": [
    {
      "file": "Contents/section0.xml",
      "index": 0,
      "text": "{{TITLE}}"
    },
    {
      "file": "Contents/section0.xml",
      "index": 1,
      "text": "작성일: {{DATE}}"
    },
    {
      "file": "Contents/section0.xml",
      "index": 2,
      "text": "1. 사업 개요"
    }
  ],
  "count": 3
}
```

필드 설명:
- `file` — HWPX 내부 XML 파일 경로
- `index` — 해당 XML 파일 내 텍스트 노드 순번 (0부터 시작)
- `text` — 텍스트 내용 (플레이스홀더 포함 여부와 무관하게 모두 반환)
- `count` — 전체 노드 수

---

### `POST /api/public/fill`

HWPX 템플릿의 `{{PLACEHOLDER}}`를 치환하고, 완성된 파일을 반환합니다.

```bash
curl -X POST https://YOUR_DOMAIN/api/public/fill \
  -F "file=@template.hwpx" \
  -F 'data={"TITLE":"2026 연간 보고서","AUTHOR":"홍길동","DATE":"2026.01.01"}' \
  --output output.hwpx
```

응답: `200 OK` — `Content-Type: application/octet-stream` (완성된 `.hwpx` 파일)

에러 응답 `400 Bad Request`:
```json
{"error": "No placeholders were replaced. Check that {{PLACEHOLDER}} keys exist in the template and match the data keys."}
```

---

### `GET /api/public/templates`

서버에 내장된 샘플 템플릿 목록과 각 템플릿의 플레이스홀더 키를 반환합니다. 플레이그라운드(`/demo`)에서 이 API를 사용합니다.

```bash
curl https://YOUR_DOMAIN/api/public/templates
```

응답 `200 OK`:
```json
{
  "templates": [
    {
      "id": "annual-report",
      "name": "연간 보고서",
      "description": "기업 연간 사업 보고서 기본 양식",
      "placeholders": ["TITLE", "AUTHOR", "DATE", "SUMMARY", "DEPARTMENT"]
    },
    {
      "id": "investment-memo",
      "name": "투자 검토 메모",
      "description": "스타트업 투자 심사 메모 양식",
      "placeholders": ["COMPANY", "REVIEWER", "DATE", "AMOUNT", "STAGE"]
    }
  ]
}
```

---

### `GET /api/public/docs`

OpenAPI 3.0.3 스펙 JSON입니다. 서드파티 도구(Postman, Insomnia, 자체 SDK 생성 등)에서 파싱할 때 사용합니다.

```bash
curl https://YOUR_DOMAIN/api/public/docs
# → OpenAPI 3.0.3 JSON (Content-Type: application/json)
```

---

### `GET /api/public/docs/ui`

Swagger UI 인터페이스입니다. 브라우저에서 API 명세를 확인하고 직접 호출해볼 수 있습니다.

```
https://YOUR_DOMAIN/api/public/docs/ui
```

---

## 설계 철학

> "재직렬화하지 마세요. 다시 열지 마세요. 노드를 찾아서 텍스트만 바꾸세요."

### 왜 다른 방식이 실패하는가

HWPX는 ZIP 아카이브 안에 XML로 모든 단락, 텍스트 런, 스타일 정의를 담고 있습니다. 대부분의 도구들은 문서 트리 전체를 파싱하고 재직렬화하는데 — 이 과정에서 문제가 생깁니다:

```
[일반적인 방법]
  원본 HWPX
      ↓ 파싱 (전체 XML 트리 읽기)
  메모리의 DOM 트리
      ↓ 수정
  수정된 DOM 트리
      ↓ 재직렬화 (전체 XML 다시 쓰기)  ← 여기서 깨짐
  출력 HWPX

  문제:
  - 한글 전용 스타일 속성이 생략되거나 변환됨
  - 임베디드 폰트 참조가 깨짐
  - XML 네임스페이스 선언 순서 변경 → 한글이 인식 못 함
  - 불필요한 whitespace 추가 → 레이아웃 틀어짐
```

### 이 프로젝트의 방법

```
[이 프로젝트의 방법]
  원본 HWPX (ZIP)
      ↓ ZIP 열기 — 파일 엔트리 목록만 읽음
  파일 엔트리들
      ↓ XML 파일만 선택 (BinData/ 등 바이너리는 건드리지 않음)
  XML 파싱 — <hp:t> 요소 위치 파악
      ↓ 텍스트만 교체 (.text 속성 하나만 변경)
  변경된 XML (나머지는 원본 바이트 그대로)
      ↓ ZIP 재압축 — 각 엔트리에 원본 메타데이터 유지
  출력 HWPX

  결과:
  - 교체한 텍스트를 제외한 모든 바이트가 동일
  - 서식, 폰트, 이미지, 레이아웃: 완벽 보존
```

구체적 단계:

1. **ZIP 열기** — 모든 파일 엔트리를 메모리로 읽기
2. **XML만 파싱** — `Contents/section*.xml` 파일만 선택, 이미지·폰트 등 바이너리는 건드리지 않음
3. **텍스트 노드 찾기** — `<hp:t>` 요소를 순회하며 `{{PLACEHOLDER}}` 패턴 또는 지정 인덱스 매칭
4. **`.text` 속성만 교체** — 속성값, 형제 노드, 부모 구조: 모두 그대로
5. **재압축** — 원래 메타데이터(파일명, 압축 방식, 수정 시각)와 함께 각 엔트리 기록

출력된 `.hwpx`는 교체한 글자를 제외하면 템플릿과 바이트 수준에서 동일합니다. 한글에서 열면 원본과 똑같이 보입니다 — 구조적으로 실제로 같으니까요.

---

## 요구사항

| 구성 요소 | 요구사항 | 비고 |
|-----------|----------|------|
| `fill_hwpx_template.py` | Python 3.8+ (표준 라이브러리만) | 외부 패키지 없음 |
| `hwpx_editor.py` | Python 3.8+ (표준 라이브러리만) | 외부 패키지 없음 |
| `build_report.py` | Python 3.8+, `requests` | OpenAI 또는 Anthropic 키 필요 |
| `pyhwpx` 패키지 | Python 3.8+ (표준 라이브러리만) | `pip install pyhwpx` |
| MCP 서버 | Node.js 18+ | `cd mcp-server && npm install && npm run build` |
| 웹 UI (개발) | Node.js 18+, npm | `cd web && npm install && npm run dev` |
| 웹 UI (배포) | Docker 또는 Node.js 18+ | Fly.io / Vercel / 셀프 호스팅 |
| `hancom-verify` | macOS + 한글 오피스 설치 | HWPX 파일 무결성 검증 전용 |

---

## 활용 사례

- **정부·공공기관** — 표준 보고서 양식 자동 작성. 한글 형식 그대로 유지하면서 내용만 자동으로 채움
- **투자사·VC** — 구조화된 데이터로 투자 검토 메모 자동 생성. 포트폴리오 회사 데이터 → 표준 메모 양식
- **컨설팅** — 마스터 템플릿 기반 납품물 대량 생산. 클라이언트별 데이터로 수백 건을 몇 초 만에
- **HR·총무팀** — 반복적인 문서 작업 자동화. 근로계약서, 발령장, 증명서 대량 발급
- **AI 파이프라인** — LLM 출력을 포맷된 HWPX로 직접 연결. ChatGPT/Claude 결과 → 한글 문서 자동 변환
- **시스템 연동** — 공개 REST API를 통해 기존 업무 시스템과 통합

---

## 기여하기

이슈와 PR 모두 환영합니다. 먼저 이슈를 열어서 방향을 논의해주세요.

**개발 환경 설정:**

```bash
# 레포지토리 클론
git clone https://github.com/merryAI-dev/hwpx-report-automation.git
cd hwpx-report-automation

# 웹 앱 개발
cd web
npm install
cp .env.example .env.local    # 환경 변수 설정
npm run dev

# MCP 서버 개발
cd ../mcp-server
npm install
npm run build
npm test

# Python 스크립트 테스트
python scripts/fill_hwpx_template.py --help
python scripts/hwpx_editor.py --help
```

**기여 아이디어:**

| 아이디어 | 난이도 | 관련 파일 |
|---------|--------|----------|
| HWP(구 바이너리 포맷) 지원 | 높음 | `scripts/`, `pyhwpx/` |
| 다단락 플레이스홀더 값 처리 | 중간 | `scripts/fill_hwpx_template.py` |
| CLI 래퍼 (`hwpx fill template.hwpx data.json`) | 낮음 | 신규 파일 |
| pyhwpx에 타입 힌트 추가 | 낮음 | `pyhwpx/pyhwpx/` |
| 플레이그라운드에 직접 파일 업로드 지원 | 중간 | `web/src/app/demo/` |

CI 기반 문서 생성 예시: `.github/workflows/examples/hwpx-ci-example.yml` 참고

---

## 자주 묻는 질문

**HWP(HWPX가 아닌 구 포맷)도 되나요?**

구형 `.hwp` 바이너리 포맷은 현재 지원하지 않습니다. HWPX는 한글 오피스 2014+ 버전의 ZIP+XML 포맷입니다. 구형 `.hwp` 파일이 있다면 한글 오피스에서 "다른 이름으로 저장 → .hwpx"로 변환 후 사용하세요. 웹 UI의 `.hwp` 업로드 기능은 외부 변환기(`HWP_CONVERTER_COMMAND`)와 연동해서 처리합니다.

**출력 파일이 한글에서 제대로 열리나요?**

네. 출력 파일은 구조적으로 입력과 동일합니다 — 교체한 텍스트만 달라졌을 뿐입니다. 한글 오피스 2014~최신 버전 모두에서 정상 동작하며, 서식·폰트·이미지가 원본과 완전히 동일하게 표시됩니다.

**Linux나 CI 환경에서도 쓸 수 있나요?**

Python 스크립트(`fill_hwpx_template.py`, `hwpx_editor.py`, `build_report.py`)와 `pyhwpx` 패키지, 웹 UI는 Linux에서 완전히 동작합니다. 한글 오피스 설치가 불필요합니다. `hancom-verify` 도구만 macOS + 한글 오피스가 필요합니다.

**표, 머리글, 바닥글도 처리되나요?**

네. `hwpx_editor.py --list`는 머리글, 바닥글, 표 안의 텍스트 노드를 포함한 `Contents/section*.xml` 내 모든 `<hp:t>` 요소를 반환합니다. `fill_hwpx_template.py` 역시 문서 전체에 걸쳐 `{{PLACEHOLDER}}`를 찾아 교체합니다.

**한 번에 여러 파일을 처리할 수 있나요?**

Python 스크립트는 파일 1개씩 처리합니다. 여러 파일을 처리하려면 쉘 스크립트로 루프를 구성하거나, 웹 UI의 배치 생성 기능(CSV 업로드 → 일괄 생성)을 사용하세요.

**MCP 서버를 빌드하려면 어떻게 하나요?**

```bash
cd mcp-server
npm install
npm run build
# → dist/index.js 생성됨
```

Node.js 18+ 이상이 필요합니다. 빌드 후 `dist/index.js`의 절대 경로를 Claude Desktop 또는 Cursor 설정에 입력하세요.

**pyhwpx와 `scripts/fill_hwpx_template.py`의 차이는 무엇인가요?**

동일한 로직을 다른 형태로 제공합니다. `scripts/fill_hwpx_template.py`는 터미널에서 바로 실행하는 CLI 스크립트이고, `pyhwpx`는 Python 코드에서 `import`해서 사용하는 패키지입니다. 파이프라인에 통합할 때는 `pyhwpx`가 더 깔끔합니다.

**플레이스홀더가 분리된 텍스트 런에 걸쳐 있으면 어떻게 되나요?**

한글 오피스에서 `{{TITLE}}`을 타이핑하면 보통 하나의 텍스트 런으로 저장됩니다. 그러나 중간에 커서를 위치시키거나 서식을 변경하면 `{{TI`, `TLE`, `}}`처럼 여러 런으로 분리될 수 있습니다. 이 경우 매칭에 실패합니다. 해결 방법: 한글 오피스에서 해당 셀/단락을 전체 선택 후 삭제하고 다시 `{{KEY}}`를 입력하세요.

---

## 배경

[MYSC](https://mysc.kr)에서 한글 형식의 보고서 — 제안서, 투자 검토 메모, 임팩트 평가서 — 를 팀이 매번 수작업으로 작성하던 것을 자동화하기 위해 만들었습니다.

계기: 누군가가 ChatGPT 결과물을 한글 템플릿에 복사붙여넣기 하는 데 매주 45분을 쓰는 걸 보고 나서.

---

## 라이선스

[MIT](LICENSE) © 2025 MYSC
