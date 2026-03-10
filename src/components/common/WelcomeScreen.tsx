"use client";

import { useCallback, useRef, useState } from "react";
import type { RecentFileSnapshotMeta } from "@/lib/recent-files";
import { DOCUMENT_TEMPLATES, type DocumentTemplate } from "@/lib/editor/document-templates";

type WelcomeScreenProps = {
  recentSnapshots: RecentFileSnapshotMeta[];
  onPickFile: (file: File) => void;
  onLoadRecentSnapshot: (id: string) => void;
  onStartFromTemplate?: (template: DocumentTemplate) => void;
};

const SUPPORTED_FORMATS = [
  { ext: ".hwpx", label: "한글 문서", desc: "한컴오피스 한글 (HWPX)" },
  { ext: ".docx", label: "Word 문서", desc: "Microsoft Word (DOCX)" },
  { ext: ".pptx", label: "PowerPoint", desc: "Microsoft PowerPoint (PPTX)" },
];

export function WelcomeScreen({
  recentSnapshots,
  onPickFile,
  onLoadRecentSnapshot,
  onStartFromTemplate,
}: WelcomeScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) onPickFile(file);
    },
    [onPickFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onPickFile(file);
    },
    [onPickFile],
  );

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900">
            HWPX 문서 편집기
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            문서를 업로드하거나 템플릿으로 시작하세요
          </p>
        </div>

        {/* Drop Zone */}
        <div
          className={`mb-6 cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
            dragActive
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="mb-3 text-3xl text-gray-400">+</div>
          <p className="text-sm font-medium text-gray-700">
            파일을 드래그하거나 클릭하여 업로드
          </p>
          <p className="mt-1 text-xs text-gray-400">
            HWPX, DOCX, PPTX 지원
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".hwpx,.docx,.pptx"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* Template Catalog */}
        {onStartFromTemplate && (
          <div className="mb-6">
            <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">
              템플릿으로 시작
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {DOCUMENT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => onStartFromTemplate(tpl)}
                  className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50"
                >
                  <span className="text-lg leading-none">{tpl.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-800">
                      {tpl.name}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug text-gray-400">
                      {tpl.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent Documents */}
        {recentSnapshots.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">
              최근 파일
            </h3>
            <div className="space-y-1">
              {recentSnapshots.slice(0, 5).map((snap) => (
                <button
                  key={snap.id}
                  type="button"
                  onClick={() => onLoadRecentSnapshot(snap.id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-sm transition-colors hover:bg-blue-50"
                >
                  <span className="flex-1 truncate font-medium text-gray-800">
                    {snap.name}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {new Date(snap.savedAt).toLocaleDateString("ko-KR", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Supported Formats */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">
            지원 형식
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {SUPPORTED_FORMATS.map((fmt) => (
              <div
                key={fmt.ext}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center"
              >
                <div className="text-xs font-bold text-blue-600">
                  {fmt.ext}
                </div>
                <div className="mt-0.5 text-[10px] text-gray-400">
                  {fmt.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Tips */}
        <div className="mt-6 rounded-lg bg-gray-100 p-4">
          <h3 className="mb-2 text-xs font-semibold text-gray-600">
            시작 가이드
          </h3>
          <ul className="space-y-1 text-xs text-gray-500">
            <li>1. 문서 파일을 업로드하거나 템플릿을 선택하세요</li>
            <li>2. 사이드바에서 AI 제안을 받거나 채팅으로 편집 지시를 내리세요</li>
            <li>3. 수정이 완료되면 HWPX로 저장하여 한컴오피스에서 열 수 있습니다</li>
            <li className="text-gray-400">
              TIP: <kbd className="rounded border bg-white px-1 py-0.5 font-mono text-[10px]">?</kbd> 키로 단축키 도움말을 볼 수 있습니다
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
