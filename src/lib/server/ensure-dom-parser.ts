export async function ensureServerDomParser(): Promise<void> {
  if (typeof DOMParser !== "undefined" && typeof NodeFilter !== "undefined") {
    return;
  }

  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("");
  (globalThis as typeof globalThis & { DOMParser?: typeof DOMParser }).DOMParser =
    dom.window.DOMParser as unknown as typeof DOMParser;
  (globalThis as typeof globalThis & { NodeFilter?: typeof NodeFilter }).NodeFilter =
    dom.window.NodeFilter as unknown as typeof NodeFilter;
}
