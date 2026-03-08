import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/auth/with-api-auth";
import { generateBatchSuggestions, type BatchItem } from "@/lib/server/batch-suggestion-service";

type RequestBody = {
  items?: BatchItem[];
  instruction?: string;
  model?: string;
};

async function handlePost(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const results = await generateBatchSuggestions({
      items: body.items || [],
      instruction: String(body.instruction || ""),
      model: body.model,
    });
    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "instruction is required" || message === "items is required" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const POST = withApiAuth(handlePost);
