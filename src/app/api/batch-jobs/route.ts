import { NextResponse } from "next/server";
import { getBatchJobManager } from "@/lib/server/batch-jobs";
import { normalizeBatchItems, type BatchItem } from "@/lib/server/batch-suggestion-service";

type RequestBody = {
  items?: BatchItem[];
  instruction?: string;
  model?: string;
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const instruction = String(body.instruction || "").trim();
    const items = normalizeBatchItems(body.items || []);
    if (!instruction) {
      return NextResponse.json({ error: "instruction is required" }, { status: 400 });
    }
    if (!items.length) {
      return NextResponse.json({ error: "items is required" }, { status: 400 });
    }

    const job = getBatchJobManager().createJob({
      items,
      instruction,
      model: body.model,
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "batch job create failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
