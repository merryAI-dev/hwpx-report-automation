"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/common/Breadcrumb";

type Version = {
  id: string;
  documentId: string;
  label: string;
  createdAt: string;
};

type VersionDetail = Version & {
  docJson: string;
};

type TextBlock = { text: string; type: string };

/** Extract plain text blocks from ProseMirror JSON for comparison */
function extractTextBlocks(docJson: string): TextBlock[] {
  try {
    const doc = JSON.parse(docJson);
    const blocks: TextBlock[] = [];
    for (const node of doc.content ?? []) {
      const texts: string[] = [];
      for (const child of node.content ?? []) {
        if (child.text) texts.push(child.text);
      }
      if (texts.length > 0) {
        blocks.push({ text: texts.join(""), type: node.type ?? "paragraph" });
      }
    }
    return blocks;
  } catch {
    return [];
  }
}

/** Simple line-by-line diff */
function computeDiff(
  oldBlocks: TextBlock[],
  newBlocks: TextBlock[],
): Array<{ type: "same" | "added" | "removed" | "changed"; old?: string; new?: string }> {
  const result: Array<{ type: "same" | "added" | "removed" | "changed"; old?: string; new?: string }> = [];
  const maxLen = Math.max(oldBlocks.length, newBlocks.length);

  for (let i = 0; i < maxLen; i++) {
    const oldText = oldBlocks[i]?.text;
    const newText = newBlocks[i]?.text;

    if (oldText === newText) {
      result.push({ type: "same", old: oldText, new: newText });
    } else if (oldText && newText) {
      result.push({ type: "changed", old: oldText, new: newText });
    } else if (!oldText && newText) {
      result.push({ type: "added", new: newText });
    } else if (oldText && !newText) {
      result.push({ type: "removed", old: oldText });
    }
  }
  return result;
}

export default function VersionComparisonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: documentId } = use(params);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [comparing, setComparing] = useState(false);
  const [diff, setDiff] = useState<ReturnType<typeof computeDiff> | null>(null);

  // Load version list
  useEffect(() => {
    fetch(`/api/documents/${documentId}/versions`)
      .then(async (r) => {
        if (!r.ok) throw new Error("버전 목록 로드 실패");
        const data = await r.json();
        setVersions(data.versions ?? []);
        if (data.versions?.length >= 2) {
          setLeftId(data.versions[1].id); // older
          setRightId(data.versions[0].id); // newer
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [documentId]);

  const handleCompare = async () => {
    if (!leftId || !rightId) return;
    setComparing(true);
    setDiff(null);
    try {
      const [leftResp, rightResp] = await Promise.all([
        fetch(`/api/documents/${documentId}/versions/${leftId}`),
        fetch(`/api/documents/${documentId}/versions/${rightId}`),
      ]);

      if (!leftResp.ok || !rightResp.ok) {
        throw new Error("버전 데이터를 불러올 수 없습니다.");
      }

      const leftData: VersionDetail = await leftResp.json();
      const rightData: VersionDetail = await rightResp.json();

      const oldBlocks = extractTextBlocks(leftData.docJson);
      const newBlocks = extractTextBlocks(rightData.docJson);
      setDiff(computeDiff(oldBlocks, newBlocks));
    } catch (e) {
      setError(e instanceof Error ? e.message : "비교 실패");
    } finally {
      setComparing(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <Breadcrumb
            items={[
              { label: "홈", href: "/" },
              { label: "문서 관리", href: "/documents" },
              { label: "버전 비교" },
            ]}
          />
          <h1 className="text-xl font-bold text-gray-900">버전 비교</h1>
          <p className="mt-1 text-sm text-gray-500">
            문서의 두 버전을 선택하여 변경 내용을 비교합니다.
          </p>
        </div>

        {loading && (
          <p className="py-20 text-center text-gray-400">버전 목록을 불러오는 중...</p>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && versions.length < 2 && (
          <div className="rounded-lg border bg-white p-8 text-center">
            <p className="text-gray-500">
              비교할 버전이 부족합니다. 문서를 2회 이상 저장한 후 이용하세요.
            </p>
            <p className="mt-1 text-xs text-gray-400">
              현재 버전 수: {versions.length}
            </p>
          </div>
        )}

        {!loading && versions.length >= 2 && (
          <>
            {/* Version selectors */}
            <div className="mb-4 flex items-end gap-4 rounded-lg border bg-white p-4">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  이전 버전 (왼쪽)
                </label>
                <select
                  value={leftId}
                  onChange={(e) => setLeftId(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} — {formatDate(v.createdAt)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pb-1 text-gray-400">vs</div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  최신 버전 (오른쪽)
                </label>
                <select
                  value={rightId}
                  onChange={(e) => setRightId(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} — {formatDate(v.createdAt)}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => void handleCompare()}
                disabled={comparing || leftId === rightId}
                className="shrink-0 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {comparing ? "비교 중..." : "비교"}
              </button>
            </div>

            {/* Diff result */}
            {diff && (
              <div className="rounded-lg border bg-white shadow-sm">
                <div className="border-b px-4 py-3">
                  <p className="text-sm font-medium text-gray-700">
                    변경 사항: {diff.filter((d) => d.type !== "same").length}건
                  </p>
                </div>
                <div className="max-h-[60vh] divide-y overflow-y-auto">
                  {diff.map((item, i) => (
                    <div
                      key={i}
                      className={`px-4 py-2 text-sm ${
                        item.type === "same"
                          ? "text-gray-600"
                          : item.type === "added"
                            ? "bg-green-50"
                            : item.type === "removed"
                              ? "bg-red-50"
                              : "bg-yellow-50"
                      }`}
                    >
                      {item.type === "same" && (
                        <span className="text-gray-500">{item.old}</span>
                      )}
                      {item.type === "added" && (
                        <div>
                          <span className="mr-2 rounded bg-green-200 px-1 text-xs text-green-800">
                            추가
                          </span>
                          <span className="text-green-800">{item.new}</span>
                        </div>
                      )}
                      {item.type === "removed" && (
                        <div>
                          <span className="mr-2 rounded bg-red-200 px-1 text-xs text-red-800">
                            삭제
                          </span>
                          <span className="text-red-800 line-through">{item.old}</span>
                        </div>
                      )}
                      {item.type === "changed" && (
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="mr-1 rounded bg-red-200 px-1 text-xs text-red-800">
                              이전
                            </span>
                            <span className="text-red-700 line-through">{item.old}</span>
                          </div>
                          <div>
                            <span className="mr-1 rounded bg-green-200 px-1 text-xs text-green-800">
                              변경
                            </span>
                            <span className="text-green-800">{item.new}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {diff.length === 0 && (
                    <p className="px-4 py-8 text-center text-gray-400">
                      두 버전이 동일합니다.
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
