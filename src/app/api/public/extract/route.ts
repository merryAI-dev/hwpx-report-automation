import { NextRequest, NextResponse } from "next/server";
import { inspectHwpx, ZipExpansionError } from "@/lib/hwpx";
import { checkRateLimit, getClientIp } from "@/lib/api-validation";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: code, message }, { status });
}

/**
 * POST /api/public/extract
 *
 * Accepts multipart/form-data:
 *   - file: .hwpx binary
 *
 * Returns all text nodes in the document.
 * No auth required. Rate limit: 2 req/min per IP.
 *
 * @example
 *   curl -X POST https://YOUR_DOMAIN/api/public/extract \
 *     -F "file=@document.hwpx"
 *
 * Response:
 *   {
 *     "nodes": [
 *       { "file": "Contents/section0.xml", "index": 0, "text": "제목 입력" },
 *       { "file": "Contents/section0.xml", "index": 3, "text": "홍길동" }
 *     ],
 *     "count": 2
 *   }
 */
export async function POST(request: NextRequest) {
  // ── Rate limiting ──
  const rateLimited = checkRateLimit(getClientIp(request), 2);
  if (rateLimited) return rateLimited;

  // ── Parse multipart ──
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return err("INVALID_REQUEST", "요청 형식이 올바르지 않습니다.", 400);
  }

  // ── File validation ──
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return err("FILE_MISSING", "file 필드가 필요합니다.", 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    return err("FILE_TOO_LARGE", "파일 크기는 10MB 이하여야 합니다.", 413);
  }

  // ── Process ──
  let result: Awaited<ReturnType<typeof inspectHwpx>>;
  try {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_SIZE) {
      return err("FILE_TOO_LARGE", "파일 크기는 10MB 이하여야 합니다.", 413);
    }
    result = await inspectHwpx(buffer);
  } catch (e) {
    if (e instanceof ZipExpansionError) {
      return err("PAYLOAD_TOO_LARGE", "압축 해제된 파일 크기가 50MB를 초과합니다.", 413);
    }
    return err("INVALID_HWPX", "유효하지 않은 HWPX 파일입니다.", 400);
  }

  const nodes = result.textNodes.map((n) => ({
    file: n.fileName,
    index: n.textIndex,
    text: n.text,
  }));

  return NextResponse.json({ nodes, count: nodes.length });
}
