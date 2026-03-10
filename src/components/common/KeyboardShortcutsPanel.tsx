"use client";

import { useEffect, useState, useCallback } from "react";

type ShortcutGroup = {
  label: string;
  items: Array<{ keys: string; desc: string }>;
};

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
const mod = isMac ? "⌘" : "Ctrl";

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "파일",
    items: [
      { keys: `${mod}+O`, desc: "파일 열기" },
      { keys: `${mod}+S`, desc: "HWPX 저장" },
    ],
  },
  {
    label: "편집",
    items: [
      { keys: `${mod}+Z`, desc: "실행 취소" },
      { keys: `${mod}+Y`, desc: "다시 실행" },
      { keys: `${mod}+A`, desc: "전체 선택" },
      { keys: `${mod}+C`, desc: "복사" },
      { keys: `${mod}+V`, desc: "붙여넣기" },
      { keys: `${mod}+X`, desc: "잘라내기" },
    ],
  },
  {
    label: "서식",
    items: [
      { keys: `${mod}+B`, desc: "굵게" },
      { keys: `${mod}+I`, desc: "기울임" },
      { keys: `${mod}+U`, desc: "밑줄" },
      { keys: "Alt+L", desc: "글자 스타일 설정" },
      { keys: "Alt+T", desc: "문단 스타일 설정" },
    ],
  },
  {
    label: "정렬",
    items: [
      { keys: `${mod}+L`, desc: "왼쪽 정렬" },
      { keys: `${mod}+E`, desc: "가운데 정렬" },
      { keys: `${mod}+R`, desc: "오른쪽 정렬" },
      { keys: `${mod}+J`, desc: "양쪽 정렬" },
    ],
  },
  {
    label: "기타",
    items: [
      { keys: "/", desc: "슬래시 명령어 메뉴" },
      { keys: "?", desc: "단축키 도움말 열기/닫기" },
      { keys: "Esc", desc: "패널 닫기" },
    ],
  },
];

export function KeyboardShortcutsPanel() {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ? key without modifier to toggle help
      if (
        e.key === "?" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement) &&
        !(e.target as HTMLElement)?.closest?.("[contenteditable]")
      ) {
        e.preventDefault();
        toggle();
      }
      // Escape to close
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, toggle]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="presentation" onClick={() => setOpen(false)}>
      <div
        className="mx-4 w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 id="shortcuts-title" className="text-base font-semibold text-gray-900">
            키보드 단축키
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="닫기"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <div className="space-y-5">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.label}>
                <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">
                  {group.label}
                </h3>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <div
                      key={item.keys}
                      className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-gray-50"
                    >
                      <span className="text-gray-700">{item.desc}</span>
                      <kbd className="ml-4 shrink-0 rounded border border-gray-200 bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600">
                        {item.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 text-center text-xs text-gray-400">
          <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono">?</kbd>
          {" "}키를 눌러 열고 닫을 수 있습니다
        </div>
      </div>
    </div>
  );
}
