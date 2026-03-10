import { NextResponse } from "next/server";

export function workspaceErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const normalized = message.toLowerCase();
  if (normalized.includes("denied")) {
    return NextResponse.json({ error: message }, { status: 403 });
  }
  if (normalized.includes("not found")) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  if (normalized.includes("blocking")) {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  if (normalized.includes("required") || normalized.includes("invalid")) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json({ error: message || fallbackMessage }, { status: 500 });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
