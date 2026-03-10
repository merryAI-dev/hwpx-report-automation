import { NextRequest, NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { analyzeHwpxCoverage } from "@/lib/server/hwpx-coverage";

export const runtime = "nodejs";

export const POST = withApiAuth(async (request: NextRequest) => {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file 필드가 필요합니다." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const report = await analyzeHwpxCoverage(buffer, file.name);
    return NextResponse.json({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "커버리지 분석 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, { requireTenant: true });
