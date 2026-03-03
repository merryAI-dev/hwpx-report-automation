"use client";

import { useCallback, useEffect, useState } from "react";

type AuditEntry = {
  id: string;
  userEmail: string;
  action: string;
  endpoint: string;
  details: string;
  createdAt: string;
};

type AuditLogResponse = {
  entries: AuditEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

const ACTION_FILTERS = [
  { value: "", label: "전체" },
  { value: "ai-suggest", label: "AI 단건 제안" },
  { value: "ai-batch", label: "AI 일괄 제안" },
  { value: "ai-chat", label: "AI 채팅" },
  { value: "ai-verify", label: "AI 검증" },
  { value: "document-open", label: "문서 열기" },
  { value: "export-hwpx", label: "HWPX 내보내기" },
  { value: "export-docx", label: "DOCX 내보내기" },
  { value: "export-pdf", label: "PDF 내보내기" },
  { value: "document-create", label: "문서 생성" },
  { value: "document-delete", label: "문서 삭제" },
];

export function AuditLogViewer() {
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");

  const fetchLogs = useCallback(async (p: number, action: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(p), limit: "20" });
      if (action) params.set("action", action);
      const resp = await fetch(`/api/dashboard/audit-log?${params}`);
      if (!resp.ok) throw new Error("감사 로그 로드 실패");
      const result: AuditLogResponse = await resp.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류 발생");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLogs(page, actionFilter);
  }, [page, actionFilter, fetchLogs]);

  const handleFilterChange = (action: string) => {
    setActionFilter(action);
    setPage(1);
  };

  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">감사 로그</h3>
        <div className="flex items-center gap-2">
          <select
            value={actionFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="rounded border px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
          >
            {ACTION_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          {data && (
            <span className="text-xs text-gray-400">
              총 {data.total}건
            </span>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-3 text-sm text-red-600">{error}</p>
      )}

      {loading && !data && (
        <p className="py-8 text-center text-sm text-gray-400">로딩 중...</p>
      )}

      {data && (
        <>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b bg-white text-gray-500">
                <tr>
                  <th className="pb-2 pr-3">시간</th>
                  <th className="pb-2 pr-3">사용자</th>
                  <th className="pb-2 pr-3">액션</th>
                  <th className="pb-2 pr-3">엔드포인트</th>
                  <th className="pb-2">상세</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.entries.map((entry) => (
                  <tr key={entry.id} className="text-gray-600">
                    <td className="whitespace-nowrap py-1.5 pr-3">
                      {new Date(entry.createdAt).toLocaleString("ko-KR", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </td>
                    <td className="py-1.5 pr-3">{entry.userEmail}</td>
                    <td className="py-1.5 pr-3">
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">
                        {entry.action}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-gray-400">
                      {entry.endpoint}
                    </td>
                    <td className="max-w-[200px] truncate py-1.5 text-gray-400">
                      {entry.details !== "{}" ? entry.details : "—"}
                    </td>
                  </tr>
                ))}
                {data.entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400">
                      {actionFilter ? "해당 액션의 로그가 없습니다" : "감사 로그가 없습니다"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="rounded border px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                이전
              </button>
              <span className="text-xs text-gray-500">
                {data.page} / {data.totalPages} 페이지
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page >= data.totalPages || loading}
                className="rounded border px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
