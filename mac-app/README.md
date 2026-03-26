# HWPX 자동화 — macOS 앱

HWPX 템플릿 파일에 내용을 채워 새 HWPX 파일을 생성하는 macOS 네이티브 앱.

> **서버 없음. 설치 없음. 내 Mac에서 로컬 실행.**

## 스크린샷

```
┌──────────────────────────────────────────────┐
│ HWPX 자동화                        [-][□][x] │
├──────────────────┬───────────────────────────┤
│ 최근 파일        │ 📄 report-template.hwpx   │
│ ────────────     │                           │
│ 📄 report.hwpx  │ TITLE                     │
│ 📄 blank.hwpx   │ [2024년 사업 보고서    ]   │
│                  │                           │
│                  │ AUTHOR                    │
│                  │ [홍길동               ]   │
│                  │                           │
│ + HWPX 파일 열기 │         [HWPX 생성하기]   │
└──────────────────┴───────────────────────────┘
```

## 빌드 방법

### 요구사항
- macOS 14.0 이상
- Xcode 15 이상
- Node.js 18 이상

### 1단계: 저장소 클론

```bash
git clone https://github.com/merryAI-dev/hwpx-report-automation.git
cd hwpx-report-automation
```

### 2단계: hwpx-core.js 번들 빌드

```bash
bash mac-app/scripts/build-core.sh
```

### 3단계: Xcode로 빌드 & 실행

```bash
open mac-app/HwpxAutomation.xcodeproj
# Xcode에서 ▶ 버튼 클릭
```

또는 커맨드라인으로:

```bash
xcodebuild \
  -project mac-app/HwpxAutomation.xcodeproj \
  -scheme HwpxAutomation \
  -configuration Release \
  build
```

### Gatekeeper 경고가 뜨는 경우

서명되지 않은 앱이라 경고가 뜰 수 있어요. 아래 명령어로 해결:

```bash
xattr -d com.apple.quarantine /path/to/HwpxAutomation.app
```

## 동작 방식

```
HWPX 파일 선택
    ↓
[Node subprocess] hwpx-core.js extract
    → 플레이스홀더 키 추출 (예: TITLE, AUTHOR, DATE)
    ↓
SwiftUI 폼에서 값 입력
    ↓
[Node subprocess] hwpx-core.js fill
    → 플레이스홀더 교체 후 새 HWPX 생성
    ↓
Finder에서 결과 파일 열림
```

## 관련 프로젝트

- [pyhwpx](../pyhwpx/) — Python 라이브러리 (pip install hwpx-automation)
- [web/](../web/) — REST API + 웹 에디터
- [mcp-server/](../mcp-server/) — AI 도구용 MCP 서버 (npx hwpx-mcp)
