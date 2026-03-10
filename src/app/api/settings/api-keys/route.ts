import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { saveApiKey, deleteApiKey, hasApiKey, type ApiProvider } from "@/lib/api-keys";
import { log } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/api-validation";

const VALID_PROVIDERS: ApiProvider[] = ["anthropic", "openai"];

function isValidProvider(p: unknown): p is ApiProvider {
  return typeof p === "string" && VALID_PROVIDERS.includes(p as ApiProvider);
}

/** GET /api/settings/api-keys — check which providers have keys configured */
export async function GET(request: Request) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  try {
    const statuses = await Promise.all(
      VALID_PROVIDERS.map(async (provider) => ({
        provider,
        configured: await hasApiKey(session.user!.email!, provider),
      })),
    );
    return NextResponse.json({ keys: statuses });
  } catch (err) {
    log.error("Failed to check API key status", err);
    return NextResponse.json({ error: "API 키 상태 확인 실패" }, { status: 500 });
  }
}

/** PUT /api/settings/api-keys — save an API key for a provider */
export async function PUT(request: Request) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  let body: { provider?: unknown; apiKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "유효하지 않은 요청입니다." }, { status: 400 });
  }

  if (!isValidProvider(body.provider)) {
    return NextResponse.json(
      { error: `지원하지 않는 프로바이더입니다. 사용 가능: ${VALID_PROVIDERS.join(", ")}` },
      { status: 400 },
    );
  }
  if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
    return NextResponse.json({ error: "API 키를 입력하세요." }, { status: 400 });
  }

  try {
    await saveApiKey(session.user.email, body.provider, body.apiKey.trim());
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error("Failed to save API key", err);
    return NextResponse.json({ error: "API 키 저장 실패" }, { status: 500 });
  }
}

/** DELETE /api/settings/api-keys — delete an API key for a provider */
export async function DELETE(request: Request) {
  const rateLimited = checkRateLimit(getClientIp(request));
  if (rateLimited) return rateLimited;

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  if (!isValidProvider(provider)) {
    return NextResponse.json(
      { error: `지원하지 않는 프로바이더입니다. 사용 가능: ${VALID_PROVIDERS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const deleted = await deleteApiKey(session.user.email, provider);
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    log.error("Failed to delete API key", err);
    return NextResponse.json({ error: "API 키 삭제 실패" }, { status: 500 });
  }
}
