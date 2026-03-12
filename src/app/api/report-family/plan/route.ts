import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { ValidationError } from "@/lib/errors";
import { handleApiError } from "@/lib/api-utils";
import {
  buildReportFamilyPlan,
  type ReportFamilyDocumentInput,
  type ReportFamilyDocumentRole,
  type ReportFamilySegment,
} from "@/lib/report-family-planner";
import type { ReportFamilyBenchmarkRun } from "@/lib/report-template-benchmark";

type SegmentInput = {
  id?: string;
  text?: string;
  type?: string;
  level?: number;
  slideNumber?: number | null;
  pageNumber?: number | null;
};

type DocumentInput = {
  documentId?: string;
  fileName?: string;
  role?: ReportFamilyDocumentRole;
  segments?: SegmentInput[];
};

type RequestBody = {
  familyName?: string;
  targetDocument?: DocumentInput;
  sourceDocuments?: DocumentInput[];
  benchmarkRun?: ReportFamilyBenchmarkRun | null;
};

function normalizeSegments(segments: SegmentInput[] | undefined, prefix: string): ReportFamilySegment[] {
  return (segments || [])
    .map((segment, index) => ({
      id: String(segment.id || `${prefix}-${index}`).trim(),
      text: String(segment.text || "").trim(),
      type: typeof segment.type === "string" ? segment.type : undefined,
      level: typeof segment.level === "number" ? segment.level : undefined,
      slideNumber: typeof segment.slideNumber === "number" ? segment.slideNumber : null,
      pageNumber: typeof segment.pageNumber === "number" ? segment.pageNumber : null,
    }))
    .filter((segment) => segment.id && segment.text);
}

function normalizeDocument(input: DocumentInput | undefined, fallbackRole: ReportFamilyDocumentRole, prefix: string): ReportFamilyDocumentInput {
  const fileName = String(input?.fileName || "").trim();
  const documentId = String(input?.documentId || prefix).trim();
  const role = (input?.role || fallbackRole) as ReportFamilyDocumentRole;
  const segments = normalizeSegments(input?.segments, documentId);

  if (!fileName) {
    throw new ValidationError(`${prefix}.fileName 필드가 필요합니다.`);
  }
  if (!segments.length) {
    throw new ValidationError(`${prefix}.segments가 비어 있습니다.`);
  }

  return {
    documentId,
    fileName,
    role,
    segments,
  };
}

async function handlePost(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const familyName = String(body.familyName || "").trim() || "보고서 패밀리";
    const targetDocument = normalizeDocument(body.targetDocument, "target_report", "targetDocument");
    const rawSources = body.sourceDocuments || [];

    if (!rawSources.length) {
      throw new ValidationError("sourceDocuments가 비어 있습니다.");
    }

    const sourceDocuments = rawSources.map((document, index) =>
      normalizeDocument(document, "reference_doc", `sourceDocuments[${index}]`),
    );

    const plan = buildReportFamilyPlan({
      familyName,
      targetDocument,
      sourceDocuments,
      benchmarkRun: body.benchmarkRun || null,
    });

    return NextResponse.json(plan);
  } catch (error) {
    return handleApiError(error, "/api/report-family/plan");
  }
}

export const POST = withApiAuth(handlePost);
