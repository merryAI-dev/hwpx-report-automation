#!/usr/bin/env bash
#
# verify-roundtrip.sh — HWPX 라운드트립 검증 (원본 vs 편집본 비교)
#
# 사용법:
#   ./scripts/hancom-verify/verify-roundtrip.sh <original.hwpx> <exported.hwpx> [output-dir]
#
# 원본과 내보내기 결과를 각각 한컴오피스에서 열고 스크린샷을 비교할 수 있도록
# 나란히 캡처합니다. 자동 이미지 비교는 포함하지 않으며, 두 스크린샷을
# 수동으로 비교하거나 별도 도구로 diff합니다.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANCOM_APP="Hancom Office HWP"

ORIGINAL="${1:-}"
EXPORTED="${2:-}"
OUTPUT_DIR="${3:-${SCRIPT_DIR}/../../screenshots/roundtrip}"

if [[ -z "$ORIGINAL" || -z "$EXPORTED" ]]; then
  echo "Usage: $0 <original.hwpx> <exported.hwpx> [output-dir]" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "═══════════════════════════════════════════"
echo " HWPX 라운드트립 검증"
echo "═══════════════════════════════════════════"
echo ""
echo "원본:     $ORIGINAL"
echo "내보내기: $EXPORTED"
echo ""

# Capture original
echo "── 1/2: 원본 캡처 ──"
ORIG_SHOT=$("$SCRIPT_DIR/verify-hwpx.sh" "$ORIGINAL" "$OUTPUT_DIR" | tail -1)
# Close
osascript -e "tell application \"$HANCOM_APP\" to try" -e "close front document saving no" -e "end try" 2>/dev/null || true
sleep 1

# Capture exported
echo ""
echo "── 2/2: 내보내기 결과 캡처 ──"
EXPORT_SHOT=$("$SCRIPT_DIR/verify-hwpx.sh" "$EXPORTED" "$OUTPUT_DIR" | tail -1)
osascript -e "tell application \"$HANCOM_APP\" to try" -e "close front document saving no" -e "end try" 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════"
echo " 비교 준비 완료"
echo "═══════════════════════════════════════════"
echo ""
echo "원본 스크린샷:     $ORIG_SHOT"
echo "내보내기 스크린샷: $EXPORT_SHOT"
echo ""
echo "macOS Preview로 비교:"
echo "  open \"$ORIG_SHOT\" \"$EXPORT_SHOT\""
echo ""

# Optional: open both in Preview for side-by-side comparison
if command -v open &>/dev/null; then
  read -rp "Preview에서 두 스크린샷을 열까요? (y/N) " answer
  if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
    open "$ORIG_SHOT" "$EXPORT_SHOT"
  fi
fi
