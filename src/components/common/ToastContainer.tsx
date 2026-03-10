"use client";

import { useToastStore, type ToastType } from "@/store/toast-store";

const TYPE_STYLES: Record<ToastType, string> = {
  success: "border-green-400 bg-green-50 text-green-800",
  error: "border-red-400 bg-red-50 text-red-800",
  info: "border-blue-400 bg-blue-50 text-blue-800",
  warning: "border-amber-400 bg-amber-50 text-amber-800",
};

const TYPE_ICONS: Record<ToastType, string> = {
  success: "\u2713",
  error: "\u2717",
  info: "\u2139",
  warning: "\u26A0",
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-14 z-[9999] flex flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-md animate-in fade-in slide-in-from-right-2 ${TYPE_STYLES[t.type]}`}
          style={{ maxWidth: 360, animation: "fadeSlideIn 0.2s ease-out" }}
        >
          <span className="mt-px font-bold">{TYPE_ICONS[t.type]}</span>
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => removeToast(t.id)}
            className="ml-1 opacity-60 hover:opacity-100"
            aria-label="닫기"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
