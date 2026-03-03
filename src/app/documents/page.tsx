"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/store/toast-store";
import { Breadcrumb } from "@/components/common/Breadcrumb";

type DocumentItem = {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

export default function DocumentsPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [sortKey, setSortKey] = useState<keyof DocumentItem>("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (key: keyof DocumentItem) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const sortIndicator = (key: keyof DocumentItem) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const fetchDocuments = useCallback(async () => {
    try {
      const resp = await fetch("/api/documents");
      if (!resp.ok) throw new Error("문서 목록 로드 실패");
      const data = await resp.json();
      setDocs(data.documents ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "문서 목록 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  const handleDelete = async (id: string, name: string) => {
    try {
      const resp = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (!resp.ok) throw new Error("삭제 실패");
      setDocs((prev) => prev.filter((d) => d.id !== id));
      setDeleteConfirm(null);
      toast.success(`"${name}" 문서가 삭제되었습니다.`);
    } catch {
      toast.error("문서 삭제에 실패했습니다.");
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (ids: string[]) => {
    setSelected((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(ids);
    });
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    const ids = Array.from(selected);
    let deleted = 0;
    for (const id of ids) {
      try {
        const resp = await fetch(`/api/documents/${id}`, { method: "DELETE" });
        if (resp.ok) deleted++;
      } catch { /* continue */ }
    }
    setDocs((prev) => prev.filter((d) => !selected.has(d.id)));
    setSelected(new Set());
    setBulkConfirm(false);
    setBulkDeleting(false);
    toast.success(`${deleted}개 문서가 삭제되었습니다.`);
  };

  const handleOpen = (id: string) => {
    // Store doc ID in sessionStorage for the editor to pick up
    sessionStorage.setItem("openDocumentId", id);
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl">
        <Breadcrumb items={[{ label: "홈", href: "/" }, { label: "문서 관리" }]} />
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">문서 관리</h1>
            <p className="mt-1 text-sm text-gray-500">
              서버에 저장된 문서를 관리합니다.
            </p>
          </div>
          <span className="text-sm text-gray-400">{docs.length}개 문서</span>
        </div>

        {docs.length > 0 && (
          <div className="mb-4">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="문서 이름으로 검색..."
              aria-label="문서 검색"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <p className="text-gray-500">문서 목록을 불러오는 중...</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
            <button
              type="button"
              onClick={() => { setLoading(true); void fetchDocuments(); }}
              className="ml-2 underline"
            >
              다시 시도
            </button>
          </div>
        )}

        {!loading && !error && docs.length === 0 && (
          <div className="rounded-lg border-2 border-dashed border-gray-300 py-16 text-center">
            <p className="text-gray-500">저장된 문서가 없습니다.</p>
            <p className="mt-2 text-sm text-gray-400">
              편집기에서 문서를 업로드하면 자동으로 서버에 저장됩니다.
            </p>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              편집기로 이동
            </button>
          </div>
        )}

        {!loading && docs.length > 0 && (() => {
          const filtered = search.trim()
            ? docs.filter((d) => d.name.toLowerCase().includes(search.trim().toLowerCase()))
            : docs;
          const filteredDocs = [...filtered].sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            const cmp = typeof av === "number" ? av - (bv as number) : String(av).localeCompare(String(bv));
            return sortDir === "asc" ? cmp : -cmp;
          });
          return (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            {/* Bulk action bar */}
            {selected.size > 0 && (
              <div className="flex items-center justify-between border-b bg-blue-50 px-4 py-2">
                <span className="text-xs font-medium text-blue-700">{selected.size}개 선택됨</span>
                <div className="flex items-center gap-2">
                  {bulkConfirm ? (
                    <>
                      <span className="text-xs text-red-600">정말 삭제하시겠습니까?</span>
                      <button
                        type="button"
                        onClick={() => void handleBulkDelete()}
                        disabled={bulkDeleting}
                        className="rounded bg-red-600 px-2.5 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {bulkDeleting ? "삭제 중..." : "확인"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setBulkConfirm(false)}
                        className="rounded bg-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-300"
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setBulkConfirm(true)}
                        className="rounded bg-red-100 px-2.5 py-1 text-xs text-red-700 hover:bg-red-200"
                      >
                        선택 삭제
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelected(new Set())}
                        className="rounded bg-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-300"
                      >
                        선택 해제
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
            {search.trim() && (
              <div className="border-b bg-gray-50 px-4 py-2 text-xs text-gray-500">
                {filteredDocs.length}개 결과 / 전체 {docs.length}개
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                  <th className="w-8 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={filteredDocs.length > 0 && filteredDocs.every((d) => selected.has(d.id))}
                      onChange={() => toggleSelectAll(filteredDocs.map((d) => d.id))}
                      aria-label="전체 선택"
                    />
                  </th>
                  <th className="px-4 py-3">
                    <button type="button" onClick={() => toggleSort("name")} className="hover:text-gray-700">
                      문서 이름{sortIndicator("name")}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <button type="button" onClick={() => toggleSort("sizeBytes")} className="hover:text-gray-700">
                      크기{sortIndicator("sizeBytes")}
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button type="button" onClick={() => toggleSort("updatedAt")} className="hover:text-gray-700">
                      수정일{sortIndicator("updatedAt")}
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button type="button" onClick={() => toggleSort("createdAt")} className="hover:text-gray-700">
                      생성일{sortIndicator("createdAt")}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDocs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      &quot;{search.trim()}&quot;에 대한 검색 결과가 없습니다.
                    </td>
                  </tr>
                )}
                {filteredDocs.map((doc) => (
                  <tr key={doc.id} className={`hover:bg-gray-50 ${selected.has(doc.id) ? "bg-blue-50/50" : ""}`}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(doc.id)}
                        onChange={() => toggleSelect(doc.id)}
                        aria-label={`${doc.name} 선택`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleOpen(doc.id)}
                        className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {doc.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {formatBytes(doc.sizeBytes)}
                    </td>
                    <td className="px-4 py-3 text-gray-500" title={doc.updatedAt}>
                      {formatDate(doc.updatedAt)}
                    </td>
                    <td className="px-4 py-3 text-gray-500" title={doc.createdAt}>
                      {formatDate(doc.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {deleteConfirm === doc.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-red-600">삭제?</span>
                          <button
                            type="button"
                            onClick={() => void handleDelete(doc.id, doc.name)}
                            className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
                          >
                            확인
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirm(null)}
                            className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-300"
                          >
                            취소
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpen(doc.id)}
                            className="rounded bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-100"
                          >
                            열기
                          </button>
                          <button
                            type="button"
                            onClick={() => router.push(`/documents/${doc.id}/versions`)}
                            className="rounded bg-gray-100 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-200"
                          >
                            버전
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirm(doc.id)}
                            className="rounded bg-gray-100 px-2.5 py-1 text-xs text-gray-600 hover:bg-red-50 hover:text-red-600"
                          >
                            삭제
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
