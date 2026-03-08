import { NextResponse } from "next/server";
import {
  DEFAULT_COLUMN_MAPPING,
  inspectTemplate,
  runBatchPipeline,
  runPlaceholderBatchPipeline,
  type BatchMode,
  type ColumnMapping,
  type PlaceholderMapping,
} from "@/lib/batch/batch-pipeline";
import { withApiAuth } from "@/lib/auth/with-api-auth";

const MAX_CSV_SIZE = 5 * 1024 * 1024;   // 5MB
const MAX_TEMPLATE_SIZE = 10 * 1024 * 1024; // 10MB

/** GET /api/batch-generate?action=inspect — 양식 필드 미리보기 */
async function handleGet(req: Request) {
  // multipart 폼으로 template 파일 받기
  try {
    const formData = await req.formData();
    const templateFile = formData.get("template");
    if (!templateFile || !(templateFile instanceof File)) {
      return NextResponse.json({ error: "template 파일이 필요합니다." }, { status: 400 });
    }
    const templateBuffer = await templateFile.arrayBuffer();
    const description = await inspectTemplate(templateBuffer);
    return NextResponse.json({ fields: description });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "양식 필드 분석에 실패했습니다." },
      { status: 500 },
    );
  }
}

async function handlePost(req: Request) {
  try {
    const formData = await req.formData();

    // ── 입력 검증 ──
    const csvFile = formData.get("csv");
    const templateFile = formData.get("template");
    const mode = (formData.get("mode") as BatchMode | null) ?? "simple";
    const pipelineType = formData.get("pipelineType") as string | null;
    const mappingRaw = formData.get("mapping");
    const statusFilterRaw = formData.get("statusFilter");

    if (!csvFile || !(csvFile instanceof File)) {
      return NextResponse.json({ error: "csv 파일이 필요합니다." }, { status: 400 });
    }
    if (!templateFile || !(templateFile instanceof File)) {
      return NextResponse.json({ error: "template 파일이 필요합니다." }, { status: 400 });
    }
    if (csvFile.size > MAX_CSV_SIZE) {
      return NextResponse.json({ error: "CSV 파일이 너무 큽니다 (최대 5MB)." }, { status: 400 });
    }
    if (templateFile.size > MAX_TEMPLATE_SIZE) {
      return NextResponse.json({ error: "템플릿 파일이 너무 큽니다 (최대 10MB)." }, { status: 400 });
    }
    if (mode !== "simple" && mode !== "ai-refine") {
      return NextResponse.json({ error: "mode는 simple 또는 ai-refine 이어야 합니다." }, { status: 400 });
    }

    // ── 파일 읽기 ──
    const csvText = await csvFile.text();
    const templateBuffer = await templateFile.arrayBuffer();

    // ── 매핑 파싱 ──
    let mapping: ColumnMapping = DEFAULT_COLUMN_MAPPING;
    if (mappingRaw && typeof mappingRaw === "string") {
      try {
        mapping = { ...DEFAULT_COLUMN_MAPPING, ...JSON.parse(mappingRaw) };
      } catch {
        return NextResponse.json({ error: "mapping JSON이 잘못되었습니다." }, { status: 400 });
      }
    }

    // ── 상태 필터 파싱 ──
    let statusFilter: string[] = ["종료", "완료"];
    if (statusFilterRaw && typeof statusFilterRaw === "string") {
      try {
        const parsed = JSON.parse(statusFilterRaw);
        if (Array.isArray(parsed)) statusFilter = parsed as string[];
      } catch {
        // 기본값 유지
      }
    }

    // ── 배치 실행 ──
    let zipBlob: Blob;

    if (pipelineType === "placeholder") {
      // 플레이스홀더 방식: {{KEY}} → CSV 값 치환
      const placeholderMapping: PlaceholderMapping = {};
      if (mappingRaw && typeof mappingRaw === "string") {
        try {
          Object.assign(placeholderMapping, JSON.parse(mappingRaw));
        } catch {
          return NextResponse.json({ error: "mapping JSON이 잘못되었습니다." }, { status: 400 });
        }
      }
      zipBlob = await runPlaceholderBatchPipeline(csvText, templateBuffer, {
        mapping: placeholderMapping,
        statusFilter,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      });
    } else {
      // 좌표 기반 방식 (기존)
      zipBlob = await runBatchPipeline(csvText, templateBuffer, {
        mode,
        mapping,
        statusFilter,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      });
    }

    const zipBuffer = await zipBlob.arrayBuffer();
    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `hwpx_batch_${mode}_${timestamp}.zip`;

    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(zipBuffer.byteLength),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "일괄 생성에 실패했습니다." },
      { status: 500 },
    );
  }
}

export const GET = withApiAuth(handleGet);
export const POST = withApiAuth(handlePost);
