import { NextRequest, NextResponse } from "next/server";
import { ValidationError, ApiError } from "@/lib/errors";
import { handleApiError, withTimeout } from "@/lib/api-utils";
import { log } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/api-validation";

const JAVA_API_URL = process.env.JAVA_API_URL || "http://localhost:8080";
const RENDER_TIMEOUT_MS = 30_000;

/**
 * Proxy: POST /api/hwpx-render
 *
 * Accepts `multipart/form-data` with a `file` field (HWPX binary),
 * forwards it to the Java hwpxlib rendering server, and returns the
 * JSON payload `{ html, elementMap, outline }`.
 */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  // ── Rate limiting ──
  const rateLimitResp = checkRateLimit(getClientIp(req));
  if (rateLimitResp) return rateLimitResp;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      throw new ValidationError("file 필드가 필요합니다.");
    }

    // ── File size validation ──
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError(
        `파일이 너무 큽니다 (${file.size} bytes, 최대 ${MAX_FILE_SIZE_BYTES} bytes).`,
      );
    }

    const upstream = new FormData();
    upstream.append("file", file);

    const response = await log.time("hwpx-render.java", () =>
      withTimeout(
        fetch(`${JAVA_API_URL}/api/render`, {
          method: "POST",
          body: upstream,
        }),
        RENDER_TIMEOUT_MS,
        "Java render API",
      ),
      { fileSize: file.size },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ApiError(
        `Java API 오류 ${response.status}: ${text}`,
        { upstreamStatus: response.status },
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ApiError("Java API가 유효하지 않은 JSON을 반환했습니다.");
    }
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error, "/api/hwpx-render");
  }
}
