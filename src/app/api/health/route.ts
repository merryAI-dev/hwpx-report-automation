import { NextResponse } from "next/server";

export async function GET() {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasDatabase = !!process.env.DATABASE_URL;

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "0.0.0",
    services: {
      openai: { configured: hasOpenAI, model: process.env.OPENAI_MODEL || "gpt-4.1-mini" },
      anthropic: { configured: hasAnthropic, model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" },
      database: { configured: hasDatabase },
    },
  });
}
