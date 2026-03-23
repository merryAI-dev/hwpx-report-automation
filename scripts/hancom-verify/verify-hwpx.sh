#!/usr/bin/env bash
#
# verify-hwpx.sh — 한컴오피스 HWP에서 HWPX 파일을 열고 스크린샷을 캡처합니다.
#
# 사용법:
#   ./scripts/hancom-verify/verify-hwpx.sh <hwpx-file> [output-dir]
#
# 요구사항:
#   - macOS + Hancom Office HWP 설치 (/Applications/Hancom Office HWP.app)
#   - Terminal.app에 Screen Recording 권한 필요
#     (시스템 설정 → 개인정보 보호 및 보안 → 화면 기록 → 터미널)
#
# 출력:
#   <output-dir>/<파일명>-<timestamp>.png
#   성공 시 스크린샷 경로를 stdout에 출력합니다.
#
set -euo pipefail

# ── Configuration ──
HANCOM_APP="Hancom Office HWP"
HANCOM_BUNDLE="com.hancom.office.hwp12.mac.general"
WAIT_OPEN_SEC=5       # 앱이 파일을 여는 데 기다리는 시간
WAIT_RENDER_SEC=3     # 렌더링 완료 대기
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/.build"

# ── Args ──
HWPX_FILE="${1:-}"
OUTPUT_DIR="${2:-${SCRIPT_DIR}/../../screenshots}"

if [[ -z "$HWPX_FILE" ]]; then
  echo "Usage: $0 <hwpx-file> [output-dir]" >&2
  exit 1
fi

if [[ ! -f "$HWPX_FILE" ]]; then
  echo "ERROR: File not found: $HWPX_FILE" >&2
  exit 1
fi

# Resolve to absolute path
HWPX_FILE="$(cd "$(dirname "$HWPX_FILE")" && pwd)/$(basename "$HWPX_FILE")"
mkdir -p "$OUTPUT_DIR"

# ── Build window-id helper (cached) ──
WINDOW_ID_BIN="$BUILD_DIR/get-window-id"
WINDOW_ID_SRC="$SCRIPT_DIR/get-window-id.swift"

if [[ ! -f "$WINDOW_ID_BIN" ]] || [[ "$WINDOW_ID_SRC" -nt "$WINDOW_ID_BIN" ]]; then
  echo "🔨 Compiling window ID helper (one-time)..."
  mkdir -p "$BUILD_DIR"
  swiftc -O "$WINDOW_ID_SRC" -o "$WINDOW_ID_BIN" 2>&1
  echo "   Compiled: $WINDOW_ID_BIN"
fi

# ── Step 1: Open file in Hancom Office ──
echo "📂 Opening: $HWPX_FILE"
open -a "$HANCOM_APP" "$HWPX_FILE"

echo "⏳ Waiting ${WAIT_OPEN_SEC}s for app to load..."
sleep "$WAIT_OPEN_SEC"

# ── Step 2: Get window ID ──
echo "🔍 Finding Hancom Office window..."
WINDOW_ID=$("$WINDOW_ID_BIN" --wait 10 --app-name "hancom" 2>/dev/null || echo "")

if [[ -z "$WINDOW_ID" ]]; then
  echo "ERROR: Could not find Hancom Office window" >&2
  echo "Tip: Is Hancom Office HWP installed? Is the file valid?" >&2
  exit 1
fi
echo "   Window ID: $WINDOW_ID"

# ── Step 3: Wait for rendering ──
echo "⏳ Waiting ${WAIT_RENDER_SEC}s for rendering..."
sleep "$WAIT_RENDER_SEC"

# ── Step 4: Capture screenshot ──
BASENAME="$(basename "$HWPX_FILE" .hwpx)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
SCREENSHOT_PATH="$OUTPUT_DIR/${BASENAME}-${TIMESTAMP}.png"

echo "📸 Capturing screenshot..."
screencapture -l "$WINDOW_ID" -o "$SCREENSHOT_PATH" 2>&1

if [[ -f "$SCREENSHOT_PATH" ]]; then
  SIZE=$(stat -f%z "$SCREENSHOT_PATH" 2>/dev/null || echo "0")
  if [[ "$SIZE" -gt 1000 ]]; then
    echo "✅ Screenshot saved: $SCREENSHOT_PATH ($SIZE bytes)"
    echo "$SCREENSHOT_PATH"
  else
    echo "⚠️  Screenshot may be blank ($SIZE bytes)" >&2
    echo "Tip: Grant Screen Recording permission to Terminal:" >&2
    echo "  시스템 설정 → 개인정보 보호 및 보안 → 화면 기록 → Terminal" >&2
    echo "$SCREENSHOT_PATH"
  fi
else
  echo "ERROR: Screenshot capture failed" >&2
  echo "Tip: Grant Screen Recording permission to Terminal:" >&2
  echo "  시스템 설정 → 개인정보 보호 및 보안 → 화면 기록 → Terminal" >&2
  exit 1
fi

echo "🏁 Done. Hancom Office is still open for manual inspection."
