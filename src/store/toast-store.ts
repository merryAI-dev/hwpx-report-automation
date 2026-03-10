import { create } from "zustand";

export type ToastType = "success" | "error" | "info" | "warning";

export type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
};

type ToastStore = {
  toasts: ToastItem[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
};

let toastCounter = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (type, message, duration = 4000) => {
    const id = `toast-${++toastCounter}`;
    set((state) => ({
      toasts: [...state.toasts.slice(-4), { id, type, message, duration }],
    }));
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, duration);
    }
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

/** Convenience helpers */
export const toast = {
  success: (msg: string, duration?: number) =>
    useToastStore.getState().addToast("success", msg, duration),
  error: (msg: string, duration?: number) =>
    useToastStore.getState().addToast("error", msg, duration ?? 6000),
  info: (msg: string, duration?: number) =>
    useToastStore.getState().addToast("info", msg, duration),
  warning: (msg: string, duration?: number) =>
    useToastStore.getState().addToast("warning", msg, duration ?? 5000),
};
