import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTemplateVersionSummary } from "@/lib/workspace-types";
import type { TemplateCatalogDiff } from "@/lib/server/template-diff";

// ── Mock Anthropic SDK ────────────────────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
      };
    },
  };
});

// Import after mock setup
const { generateTemplateVersionReview } = await import("./ai-review");

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeVersion(overrides: Partial<WorkspaceTemplateVersionSummary> = {}): WorkspaceTemplateVersionSummary {
  return {
    id: "version-1",
    templateId: "template-1",
    versionNumber: 1,
    fileName: "template.hwpx",
    blob: {
      blobId: "blob-1",
      provider: "fs",
      fileName: "template.hwpx",
      contentType: "application/hwp+zip",
      byteLength: 1024,
      createdAt: "2024-01-01T00:00:00Z",
    },
    catalogVersion: "v1",
    fieldCount: 5,
    issueCount: 0,
    blockingIssueCount: 0,
    createdAt: "2024-01-01T00:00:00Z",
    createdBy: "user-1",
    createdByDisplayName: "Test User",
    catalog: {
      version: "v1",
      fieldCount: 5,
      rawTagCount: 0,
      fields: [
        { key: "NAME", originalKey: "NAME", type: "text", label: "이름", required: true, defaultValue: "", options: [], description: "", occurrences: [] },
        { key: "DATE", originalKey: "DATE", type: "date", label: "날짜", required: false, defaultValue: "", options: [], description: "", occurrences: [] },
      ],
      issues: [],
    },
    ...overrides,
  };
}

function makeApproveResponse() {
  return {
    content: [
      {
        type: "tool_use",
        id: "tool-1",
        name: "submit_review",
        input: {
          verdict: "approve",
          summary: "템플릿이 정상 상태입니다. 이슈가 없습니다.",
          concerns: [],
          suggestions: ["필드 설명을 더 자세하게 작성하면 좋겠습니다."],
        },
      },
    ],
    model: "claude-haiku-4-5-20251001",
  };
}

function makeNeedsWorkResponse() {
  return {
    content: [
      {
        type: "tool_use",
        id: "tool-2",
        name: "submit_review",
        input: {
          verdict: "needs-work",
          summary: "차단 이슈가 있어 수정이 필요합니다.",
          concerns: ["차단 이슈 3개가 있습니다.", "필수 필드가 삭제되었습니다."],
          suggestions: ["이슈를 모두 해결하고 재제출하세요."],
        },
      },
    ],
    model: "claude-haiku-4-5-20251001",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("generateTemplateVersionReview", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns a valid review structure for first version (diff=null)", async () => {
    mockCreate.mockResolvedValue(makeApproveResponse());

    const result = await generateTemplateVersionReview({
      templateName: "테스트 템플릿",
      version: makeVersion(),
      diff: null,
      apiKey: "test-key",
    });

    expect(result.verdict).toBe("approve");
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(result.concerns)).toBe(true);
    expect(Array.isArray(result.suggestions)).toBe(true);
    expect(typeof result.model).toBe("string");
  });

  it("returns needs-work verdict when blocking issues present", async () => {
    mockCreate.mockResolvedValue(makeNeedsWorkResponse());

    const versionWithIssues = makeVersion({
      blockingIssueCount: 3,
      issueCount: 5,
    });

    const result = await generateTemplateVersionReview({
      templateName: "문제 있는 템플릿",
      version: versionWithIssues,
      diff: null,
      apiKey: "test-key",
    });

    expect(result.verdict).toBe("needs-work");
    expect(result.concerns.length).toBeGreaterThan(0);
  });

  it("handles diff with added fields", async () => {
    mockCreate.mockResolvedValue(makeApproveResponse());

    const diff: TemplateCatalogDiff = {
      fromVersionId: "v1",
      toVersionId: "v2",
      addedCount: 2,
      removedCount: 0,
      changedCount: 1,
      entries: [
        {
          key: "NEW_FIELD",
          status: "added",
          oldField: null,
          newField: {
            key: "NEW_FIELD",
            originalKey: "NEW_FIELD",
            type: "text",
            label: "새 필드",
            required: false,
            defaultValue: "",
            options: [],
            description: "",
            occurrences: [],
          },
          changedProps: [],
        },
        {
          key: "DATE",
          status: "changed",
          oldField: {
            key: "DATE",
            originalKey: "DATE",
            type: "date",
            label: "날짜",
            required: false,
            defaultValue: "",
            options: [],
            description: "",
            occurrences: [],
          },
          newField: {
            key: "DATE",
            originalKey: "DATE",
            type: "date",
            label: "날짜 (변경됨)",
            required: true,
            defaultValue: "",
            options: [],
            description: "",
            occurrences: [],
          },
          changedProps: ["label", "required"],
        },
      ],
    };

    const result = await generateTemplateVersionReview({
      templateName: "변경된 템플릿",
      version: makeVersion({ versionNumber: 2 }),
      diff,
      apiKey: "test-key",
    });

    expect(result.verdict).toBe("approve");
    // Verify that the API was called with a prompt containing diff info
    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("추가된 필드: 2개");
    expect(callArgs.messages[0].content).toContain("변경된 필드: 1개");
  });

  it("uses the correct model name", async () => {
    mockCreate.mockResolvedValue(makeApproveResponse());

    const result = await generateTemplateVersionReview({
      templateName: "템플릿",
      version: makeVersion(),
      diff: null,
      apiKey: "test-key",
    });

    expect(result.model).toBe("claude-haiku-4-5-20251001");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5-20251001" }),
    );
  });

  it("throws when AI response has no tool_use block", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "No tool use here" }],
      model: "claude-haiku-4-5-20251001",
    });

    await expect(
      generateTemplateVersionReview({
        templateName: "템플릿",
        version: makeVersion(),
        diff: null,
        apiKey: "test-key",
      }),
    ).rejects.toThrow();
  });
});
