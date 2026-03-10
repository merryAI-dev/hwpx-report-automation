import { NextResponse } from "next/server";
import { convertLegacyHwpFile, HwpIntakeError } from "@/lib/server/hwp-converter";

export const runtime = "nodejs";

function buildAttachmentHeader(fileName: string): string {
  const asciiFallback = fileName.replace(/[^A-Za-z0-9._-]/g, "_") || "converted.hwpx";
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "`file` 필드가 필요합니다." }, { status: 400 });
    }
    if (!file.size) {
      return NextResponse.json({ error: "빈 파일은 변환할 수 없습니다." }, { status: 400 });
    }

    const result = await convertLegacyHwpFile(file);
    return new NextResponse(result.outputBuffer, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": buildAttachmentHeader(result.outputFileName),
        "x-converted-file-name": result.outputFileName,
        "x-hwp-intake-source": "legacy-hwp",
      },
    });
  } catch (error) {
    if (error instanceof HwpIntakeError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: error.status },
      );
    }

    const message = error instanceof Error ? error.message : "HWP intake 실패";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
