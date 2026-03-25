import { NextResponse } from "next/server";

export const runtime = "nodejs";

const TEMPLATES = [
  {
    name: "blank",
    description: "빈 HWPX 문서 ({{TITLE}}, {{AUTHOR}} 플레이스홀더 포함)",
    url: "/samples/blank.hwpx",
  },
  {
    name: "report",
    description: "보고서 템플릿 ({{TITLE}}, {{DATE}}, {{CONTENT}} 포함)",
    url: "/samples/report.hwpx",
  },
];

export function GET() {
  return NextResponse.json(TEMPLATES);
}
