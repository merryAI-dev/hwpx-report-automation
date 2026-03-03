import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useToastStore, toast } from "./toast-store";

function getState() {
  return useToastStore.getState();
}

describe("toast-store", () => {
  beforeEach(() => {
    // Clear all toasts
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with empty toasts", () => {
    expect(getState().toasts).toEqual([]);
  });

  it("adds a toast with correct fields", () => {
    getState().addToast("success", "저장 완료");
    const toasts = getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("success");
    expect(toasts[0].message).toBe("저장 완료");
    expect(toasts[0].id).toMatch(/^toast-/);
  });

  it("removes a toast by id", () => {
    getState().addToast("info", "테스트", 0); // duration 0 = no auto-remove
    const id = getState().toasts[0].id;
    getState().removeToast(id);
    expect(getState().toasts).toHaveLength(0);
  });

  it("auto-removes toast after duration", () => {
    getState().addToast("success", "자동 삭제", 3000);
    expect(getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(getState().toasts).toHaveLength(0);
  });

  it("limits to 5 toasts max", () => {
    for (let i = 0; i < 7; i++) {
      getState().addToast("info", `toast-${i}`, 0);
    }
    expect(getState().toasts.length).toBeLessThanOrEqual(5);
  });

  describe("convenience helpers", () => {
    it("toast.success adds success type", () => {
      toast.success("성공");
      expect(getState().toasts[0].type).toBe("success");
    });

    it("toast.error adds error type with longer duration", () => {
      toast.error("오류");
      expect(getState().toasts[0].type).toBe("error");
      expect(getState().toasts[0].duration).toBe(6000);
    });

    it("toast.warning adds warning type", () => {
      toast.warning("경고");
      expect(getState().toasts[0].type).toBe("warning");
      expect(getState().toasts[0].duration).toBe(5000);
    });

    it("toast.info adds info type", () => {
      toast.info("정보");
      expect(getState().toasts[0].type).toBe("info");
    });
  });
});
