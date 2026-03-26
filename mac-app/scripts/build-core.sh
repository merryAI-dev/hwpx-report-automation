#!/usr/bin/env bash
# hwpx-core.js 번들 빌드 스크립트
# 실행: bash mac-app/scripts/build-core.sh
# 결과: mac-app/Resources/hwpx-core.js

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WEB_DIR="$REPO_ROOT/web"
OUT_DIR="$SCRIPT_DIR/../Resources"
OUT_FILE="$OUT_DIR/hwpx-core.js"
ENTRY="$WEB_DIR/src/lib/hwpx.ts"

echo "▶ hwpx-core.js 번들 시작..."

# esbuild 확인
if ! command -v npx &>/dev/null; then
  echo "❌ npx를 찾을 수 없어요. Node.js를 설치해주세요: https://nodejs.org"
  exit 1
fi

mkdir -p "$OUT_DIR"

# esbuild로 번들 (Node.js CJS, 외부 의존성 없음)
cd "$WEB_DIR"
npx esbuild "$ENTRY" \
  --bundle \
  --platform=node \
  --format=cjs \
  --outfile="$OUT_FILE" \
  --external:next \
  --log-level=warning

# stdin/stdout JSON 래퍼 추가
cat >> "$OUT_FILE" << 'EOF'

// ─── stdin/stdout JSON 브리지 (HwpxBridge.swift ↔ hwpx-core.js) ───
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, terminal: false });
let inputChunks = [];
rl.on("line", (line) => inputChunks.push(line));
rl.on("close", async () => {
  try {
    const req = JSON.parse(inputChunks.join(""));
    let result;
    if (req.command === "extract") {
      const { inspectHwpx } = module.exports;
      const buf = require("fs").readFileSync(req.filePath);
      result = { keys: inspectHwpx(buf) };
    } else if (req.command === "fill") {
      const { fillHwpx } = module.exports;
      const buf = require("fs").readFileSync(req.filePath);
      const filled = fillHwpx(buf, req.data || {});
      const tmpPath = require("os").tmpdir() + "/hwpx-result-" + Date.now() + ".hwpx";
      require("fs").writeFileSync(tmpPath, filled);
      result = { outputPath: tmpPath };
    } else {
      result = { error: "Unknown command: " + req.command };
    }
    process.stdout.write(JSON.stringify(result));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
});
EOF

echo "✅ 번들 완료: $OUT_FILE"
echo "   크기: $(wc -c < "$OUT_FILE" | tr -d ' ') bytes"
