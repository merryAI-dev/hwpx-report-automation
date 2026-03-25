import { NextResponse } from "next/server";
import spec from "../../../../../public/openapi.json";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(spec, {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  });
}
