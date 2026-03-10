import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/suggest/route";
import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("suggest route auth", () => {
  it("rejects unauthenticated requests before hitting the AI path", async () => {
    const request = new Request("http://localhost/api/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "원문",
        instruction: "더 자연스럽게",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Authentication required.",
    });
  });

  it("allows authenticated requests through to the route handler", async () => {
    process.env.AUTH_SECRET = "test-secret";
    delete process.env.OPENAI_API_KEY;

    const token = await createSessionToken("admin@example.com");
    const request = new Request("http://localhost/api/suggest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      },
      body: JSON.stringify({
        text: "원문",
        instruction: "더 자연스럽게",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "OpenAI API 키가 설정되지 않았습니다.",
    });
  });
});
