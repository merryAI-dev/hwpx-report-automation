#!/usr/bin/env bash
#
# verify-all.sh — examples/ 폴더의 모든 HWPX 파일을 한컴오피스로 검증합니다.
#
# 사용법:
#   ./scripts/hancom-verify/verify-all.sh [examples-dir] [output-dir]
#
# 각 파일을 순서대로 열고, 스크린샷을 캡처한 뒤 닫고 다음 파일로 넘어갑니다.
# 결과 요약을 마지막에 출력합니다.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXAMPLES_DIR="${1:-${SCRIPT_DIR}/../../examples}"
OUTPUT_DIR="${2:-${SCRIPT_DIR}/../../screenshots}"
HANCOM_APP="Hancom Office HWP"
BUILD_DIR="$SCRIPT_DIR/.build"

mkdir -p "$OUTPUT_DIR"

# ── Pre-compile window ID helper ──
WINDOW_ID_BIN="$BUILD_DIR/get-window-id"
WINDOW_ID_SRC="$SCRIPT_DIR/get-window-id.swift"

if [[ ! -f "$WINDOW_ID_BIN" ]] || [[ "$WINDOW_ID_SRC" -nt "$WINDOW_ID_BIN" ]]; then
  echo "🔨 Compiling window ID helper..."
  mkdir -p "$BUILD_DIR"
  swiftc -O "$WINDOW_ID_SRC" -o "$WINDOW_ID_BIN" 2>&1
fi

echo "═══════════════════════════════════════════"
echo " 한컴오피스 HWPX 일괄 검증"
echo "═══════════════════════════════════════════"
echo ""
echo "Examples dir: $EXAMPLES_DIR"
echo "Output dir:   $OUTPUT_DIR"
echo ""

# Collect HWPX files
FILES=()
for f in "$EXAMPLES_DIR"/*.hwpx; do
  [[ -f "$f" ]] && FILES+=("$f")
done

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No .hwpx files found in $EXAMPLES_DIR"
  exit 0
fi

echo "Found ${#FILES[@]} HWPX files to verify."
echo ""

PASS=0
FAIL=0
RESULTS=()

for HWPX_FILE in "${FILES[@]}"; do
  BASENAME="$(basename "$HWPX_FILE")"
  echo "────────────────────────────────"
  echo "▶ $BASENAME"

  RESULT="PASS"
  SCREENSHOT=""

  # Open
  open -a "$HANCOM_APP" "$HWPX_FILE"
  sleep 4

  # Get window ID
  WINDOW_ID=$("$WINDOW_ID_BIN" --wait 10 --app-name "hancom" 2>/dev/null || echo "")

  if [[ -z "$WINDOW_ID" ]]; then
    echo "  ❌ Window not found"
    RESULT="FAIL"
  else
    sleep 2

    TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
    SCREENSHOT_PATH="$OUTPUT_DIR/${BASENAME%.hwpx}-${TIMESTAMP}.png"

    screencapture -l "$WINDOW_ID" -o "$SCREENSHOT_PATH" 2>/dev/null

    if [[ -f "$SCREENSHOT_PATH" ]]; then
      SIZE=$(stat -f%z "$SCREENSHOT_PATH" 2>/dev/null || echo "0")
      if [[ "$SIZE" -gt 1000 ]]; then
        echo "  ✅ Screenshot: $SCREENSHOT_PATH ($SIZE bytes)"
        SCREENSHOT="$SCREENSHOT_PATH"
      else
        echo "  ⚠️  Screenshot too small ($SIZE bytes) — may be blank"
        RESULT="WARN"
        SCREENSHOT="$SCREENSHOT_PATH"
      fi
    else
      echo "  ❌ Screenshot capture failed"
      RESULT="FAIL"
    fi
  fi

  # Close the document (try gracefully)
  osascript -e "
    tell application \"$HANCOM_APP\"
      try
        close front document saving no
      end try
    end tell
  " 2>/dev/null || true

  sleep 1

  if [[ "$RESULT" == "PASS" ]]; then
    ((PASS++))
  else
    ((FAIL++))
  fi

  RESULTS+=("$RESULT|$BASENAME|$SCREENSHOT")
done

# ── Summary ──
echo ""
echo "═══════════════════════════════════════════"
echo " 검증 결과 요약"
echo "═══════════════════════════════════════════"
echo ""
printf "%-6s %-40s %s\n" "상태" "파일" "스크린샷"
echo "────── ──────────────────────────────────── ─────────────────"

for ENTRY in "${RESULTS[@]}"; do
  IFS='|' read -r STATUS FNAME SPATH <<< "$ENTRY"
  printf "%-6s %-40s %s\n" "$STATUS" "$FNAME" "$SPATH"
done

echo ""
echo "Total: ${#FILES[@]} | Pass: $PASS | Fail: $FAIL"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
