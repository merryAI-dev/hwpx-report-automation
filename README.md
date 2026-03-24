# hwpx-report-automation

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

## 이게 뭔가요?

한글(HWP/HWPX)은 한국의 지배적인 문서 포맷입니다 — 사실상 모든 정부 기관, 공공기관, 기업에서 사용됩니다. 하지만 `.hwpx` 파일을 코드로 편집할 수 있는 **공개 API는 존재하지 않습니다.**

기존 우회책들은 모두 문제가 있습니다:
- 한글 오피스를 자동화로 열기 → 라이선스 필요, 서버에서 동작 불가
- XML 전체 재직렬화 → 스타일 깨짐, 폰트 손실
- DOCX로 내보내기 → 원본 서식 파괴

이 프로젝트는 다릅니다. HWPX의 실체에서 출발합니다 — **XML 파일들을 담은 ZIP 아카이브** — 그리고 지정한 텍스트 노드만 정밀하게 교체합니다. 나머지는 바이트 수준까지 그대로입니다.

```
template.hwpx  →  fill_hwpx_template.py  →  output.hwpx
                        ↑
                  {"TITLE": "2025 연간 보고서",
                   "AUTHOR": "홍길동"}
```

---

## 구성

```
hwpx-report-automation/
├── scripts/
│   ├── fill_hwpx_template.py   템플릿 플레이스홀더 치환 ({{KEY}} → 값)
│   ├── hwpx_editor.py          텍스트 노드 검사 및 편집 (저수준)
│   ├── build_report.py         AI 기반 보고서 생성 파이프라인
│   └── hancom-verify/          HWPX 무결성 검증 도구 (Swift/macOS)
│
└── web/                        Next.js 웹 애플리케이션
    ├── src/app/                페이지 및 API 라우트 (엔드포인트 64개)
    ├── src/lib/                비즈니스 로직 — HWPX 처리, AI 연동
    └── prisma/                 SQLite 데이터베이스 스키마 (LibSQL)
```

---

## 빠른 시작

### 템플릿 채우기 (Python, 의존성 없음)

```bash
# 1. 한글 오피스에서 .hwpx 파일의 원하는 위치에 {{KEY}} 형식으로 표시
#    (일반 텍스트처럼 입력하면 됩니다)

# 2. 데이터 파일 작성
cat > data.json << 'EOF'
{
  "TITLE": "2025 연간 보고서",
  "SUMMARY": "1~4분기 주요 내용입니다.",
  "AUTHOR": "홍길동"
}
EOF

# 3. 채우고 내보내기
python scripts/fill_hwpx_template.py \
  --template template.hwpx \
  --data-json data.json \
  --output output.hwpx
# → Created: output.hwpx
```

한글 오피스 불필요. COM 자동화 불필요. Docker 불필요. Python 표준 라이브러리만으로 동작합니다.

---

### 텍스트 노드 검사 및 직접 편집 (Python)

```bash
# 모든 텍스트 노드를 인덱스·스타일 속성과 함께 출력
python scripts/hwpx_editor.py --input report.hwpx --list

# 출력 예시:
# [{"file_name": "Contents/content0.xml", "text_index": 3, "text": "제목 입력", ...}]

# 인덱스 기반으로 특정 노드 직접 편집
python scripts/hwpx_editor.py \
  --input report.hwpx \
  --edits-json edits.json \
  --output report_edited.hwpx
```

---

### AI 보고서 생성 (Python + OpenAI/Anthropic)

```bash
pip install requests

export OPENAI_API_KEY=sk-...

python scripts/build_report.py \
  --template template.hwpx \
  --prompt "SaaS 기업의 3분기 사업 검토 보고서를 작성해줘" \
  --output report.hwpx
```

---

### HWPX Studio — 웹 UI (Next.js)

브라우저에서 바로 쓰는 풀스택 HWPX 편집기. Vercel/Fly.io에 바로 배포 가능합니다.

**주요 기능:**
- HWPX 업로드 → 텍스트 노드 탐색 및 편집
- 구형 `.hwp` 업로드 (외부 변환기 연동)
- AI 채팅 사이드바 — 마크다운 렌더링 지원, 섹션 일괄 재작성 (Anthropic / OpenAI / Google Gemini BYOK)
- PPTX 분석 → HWPX 보고서 생성 마법사 (4단계)
- `{{PLACEHOLDER}}` 치환, 배치 문서 생성
- 문서함·대시보드 — Notion 스타일 UI
- 로컬 임시저장 (30초마다 localStorage 자동 저장 + 복원 배너)
- HWPX 무결성 검사, 사용자/쿼터 관리

```bash
cd web
cp .env.example .env.local   # API 키 입력
npm install
npm run dev
# → http://localhost:3000
```

---

## 상황별 도구 선택

| 하고 싶은 것 | 도구 | 명령어 |
|-------------|------|--------|
| 템플릿 한 번 채우기 | Python 스크립트 | `fill_hwpx_template.py` |
| HWPX 내부 구조 확인 | Python 스크립트 | `hwpx_editor.py --list` |
| AI로 보고서 내용 생성 | Python 스크립트 | `build_report.py` |
| 문서 대량 생성 | 웹 UI | `npm run dev` |
| HWPX 파일 무결성 검증 | hancom-verify | `scripts/hancom-verify/` 참고 |
| 파이프라인에 통합 | Python API | `apply_placeholders()` import |

---

## 설계 철학

> "재직렬화하지 마세요. 다시 열지 마세요. 노드를 찾아서 텍스트만 바꾸세요."

HWPX는 ZIP 아카이브 안에 XML로 모든 단락, 텍스트 런, 스타일 정의를 담고 있습니다. 대부분의 도구들은 문서 트리 전체를 재직렬화하는데 — 이 과정에서 한글만의 독점 스타일 참조가 깨지거나, 임베디드 폰트가 유실되거나, 렌더러 힌트가 손상될 수 있습니다.

우리의 접근:

1. **ZIP 열기** — 모든 파일 엔트리를 메모리로 읽기
2. **XML만 파싱** — 이미지, 폰트 등 바이너리 에셋은 건드리지 않음
3. **텍스트 노드 찾기** — `{{PLACEHOLDER}}` 패턴 또는 지정 인덱스 매칭
4. **`.text` 속성만 교체** — 속성값, 형제 노드, 부모 구조: 모두 그대로
5. **재압축** — 원래 메타데이터(파일명, 압축 방식, 타임스탬프)와 함께 각 엔트리 기록

출력된 `.hwpx`는 교체한 글자를 제외하면 템플릿과 바이트 수준에서 동일합니다. 한글에서 열면 원본과 똑같이 보입니다 — 구조적으로 실제로 같으니까요.

---

## 요구사항

| 구성 요소 | 요구사항 |
|-----------|----------|
| `fill_hwpx_template.py` | Python 3.8+ (표준 라이브러리만) |
| `hwpx_editor.py` | Python 3.8+ (표준 라이브러리만) |
| `build_report.py` | Python 3.8+, `requests`, OpenAI/Anthropic 키 |
| 웹 UI | Node.js 18+, npm |
| `hancom-verify` | macOS + 한글 오피스 설치 필요 |

---

## 활용 사례

- **정부·공공기관** — 표준 보고서 양식 자동 작성
- **투자사** — 구조화된 데이터로 투자 검토 메모 자동 생성
- **컨설팅** — 마스터 템플릿 기반 납품물 대량 생산
- **HR·총무팀** — 반복적인 문서 작업 자동화
- **AI 파이프라인** — LLM 출력을 포맷된 HWPX로 직접 연결

---

## 기여하기

이슈와 PR 모두 환영합니다.

큰 변경사항은 먼저 이슈로 방향을 논의해주세요. 위 프로젝트 구조를 참고해서 수정할 파일을 찾아보세요.

기여 아이디어:
- HWP(구 바이너리 포맷) 지원 추가
- 다단락 플레이스홀더 값 처리 개선
- CLI 래퍼 (`hwpx fill template.hwpx data.json`)
- CI 기반 문서 생성 GitHub Actions 예제

---

## 자주 묻는 질문

**HWP(HWPX가 아닌 구 포맷)도 되나요?**
아직 지원하지 않습니다. HWP는 바이너리 포맷이고, HWPX는 한글 오피스 2014+의 ZIP+XML 포맷입니다.

**출력 파일이 한글에서 제대로 열리나요?**
네. 출력 파일은 구조적으로 입력과 동일합니다 — 교체한 텍스트만 달라졌을 뿐입니다.

**Linux나 CI 환경에서도 쓸 수 있나요?**
Python 스크립트는 가능합니다. 한글 오피스 설치 불필요. `hancom-verify` 도구만 macOS가 필요합니다.

**표, 머리글, 바닥글도 처리되나요?**
`hwpx_editor.py --list`는 머리글, 바닥글, 표 안의 텍스트 노드를 포함한 모든 XML 파일의 노드를 보여줍니다. `fill_hwpx_template.py`는 문서 전체에 걸쳐 `{{PLACEHOLDERS}}`를 찾아 교체합니다.

---

## 배경

[MYSC](https://mysc.kr)에서 한글 형식의 보고서 — 제안서, 투자 검토 메모, 임팩트 평가서 — 를 팀이 매번 수작업으로 작성하던 것을 자동화하기 위해 만들었습니다.

계기: 누군가가 ChatGPT 결과물을 한글 템플릿에 복사붙여넣기 하는 데 매주 45분을 쓰는 걸 보고 나서.

---

## 라이선스

[MIT](LICENSE) © 2025 MYSC
