import { NextRequest, NextResponse } from "next/server";
import { applyPlaceholders } from "@/lib/hwpx";
import { checkRateLimit, getClientIp } from "@/lib/api-validation";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: code, message }, { status });
}

/**
 * POST /api/public/fill
 *
 * Accepts multipart/form-data:
 *   - file: .hwpx binary
 *   - data: JSON string (e.g. '{"TITLE":"2026 보고서"}')
 *
 * Returns the filled .hwpx as application/octet-stream.
 * No auth required. Rate limit: 2 req/min per IP.
 *
 * @example
 *   curl -X POST https://YOUR_DOMAIN/api/public/fill \
 *     -F "file=@template.hwpx" \
 *     -F 'data={"TITLE":"2026 보고서","AUTHOR":"홍길동"}' \
 *     --output output.hwpx
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

  // ── data JSON parsing ──
  let placeholders: Record<string, string> = {};
  const dataRaw = formData.get("data");
  if (dataRaw !== null) {
    try {
      const parsed: unknown = JSON.parse(String(dataRaw));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return err("INVALID_DATA", "data 필드는 JSON 객체여야 합니다.", 400);
      }
      if (
        Object.values(parsed as Record<string, unknown>).some(
          (v) => typeof v !== "string",
        )
      ) {
        return err("INVALID_DATA", "data 필드의 값은 문자열이어야 합니다.", 400);
      }
      placeholders = parsed as Record<string, string>;
    } catch {
      return err("INVALID_DATA", "data 필드는 JSON 객체여야 합니다.", 400);
    }
  }

  // ── Process ──
  let outputBlob: Blob;
  try {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_SIZE) {
      return err("FILE_TOO_LARGE", "파일 크기는 10MB 이하여야 합니다.", 413);
    }
    outputBlob = await applyPlaceholders(buffer, placeholders);
  } catch {
    return err("INVALID_HWPX", "유효하지 않은 HWPX 파일입니다.", 400);
  }

  return new Response(outputBlob, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="output.hwpx"',
    },
  });
}
