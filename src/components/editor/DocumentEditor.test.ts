import { act } from "react";
import React from "react";
import ReactDOMClient from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSONContent } from "@tiptap/core";

const useEditorMock = vi.fn();

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/editor/extensions", () => ({
  createEditorExtensions: vi.fn(() => []),
}));

vi.mock("./EditorBubbleMenu", () => ({
  EditorBubbleMenu: () => null,
}));

vi.mock("@tiptap/react", async () => {
  const React = await import("react");

  return {
    EditorContent: ({ className }: { className?: string }) =>
      React.createElement("div", { className, "data-testid": "editor-content" }),
    useEditor: (options: unknown) => useEditorMock(options),
  };
});

import { DocumentEditor } from "./DocumentEditor";

type DocumentEditorHookOptions = {
  onUpdate: ({ editor }: { editor: { getJSON: () => JSONContent } }) => void;
};

function createDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

describe("DocumentEditor", () => {
  let container: HTMLDivElement;
  let root: ReactDOMClient.Root;

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    if (container) {
      container.remove();
    }
    useEditorMock.mockReset();
  });

  it("skips setContent on the store echo after a local editor update", () => {
    const initialContent = createDoc("alpha");
    const echoedContent = createDoc("beta");
    const remoteContent = createDoc("gamma");

    const setContent = vi.fn();
    const editor = {
      commands: {
        setContent,
      },
      getJSON: vi.fn(() => initialContent),
      state: {
        selection: {
          $from: { parent: { attrs: {} } },
        },
        doc: {
          textBetween: vi.fn(() => ""),
        },
      },
    };

    let capturedOptions: DocumentEditorHookOptions | undefined;

    useEditorMock.mockImplementation((options) => {
      capturedOptions = options as typeof capturedOptions;
      return editor;
    });

    const onUpdateDoc = vi.fn();
    const onSelectionChange = vi.fn();
    const onEditorReady = vi.fn();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOMClient.createRoot(container);

    act(() => {
      root.render(
        React.createElement(DocumentEditor, {
          content: initialContent,
          onUpdateDoc,
          onSelectionChange,
          onEditorReady,
        }),
      );
    });

    expect(setContent).not.toHaveBeenCalled();
    expect(capturedOptions).toBeDefined();

    act(() => {
      capturedOptions?.onUpdate({
        editor: {
          getJSON: () => echoedContent,
        },
      });
    });

    expect(onUpdateDoc).toHaveBeenCalledWith(echoedContent);

    act(() => {
      root.render(
        React.createElement(DocumentEditor, {
          content: echoedContent,
          onUpdateDoc,
          onSelectionChange,
          onEditorReady,
        }),
      );
    });

    expect(setContent).not.toHaveBeenCalled();

    act(() => {
      root.render(
        React.createElement(DocumentEditor, {
          content: remoteContent,
          onUpdateDoc,
          onSelectionChange,
          onEditorReady,
        }),
      );
    });

    expect(setContent).toHaveBeenCalledWith(remoteContent, { emitUpdate: false });
  });

  it("hydrates the editor when content arrives after an initial null mount", () => {
    const loadedContent = createDoc("loaded");

    const setContent = vi.fn();
    const editor = {
      commands: {
        setContent,
      },
      getJSON: vi.fn(() => createDoc("empty")),
      state: {
        selection: {
          $from: { parent: { attrs: {} } },
        },
        doc: {
          textBetween: vi.fn(() => ""),
        },
      },
    };

    useEditorMock.mockReturnValue(editor);

    const onUpdateDoc = vi.fn();
    const onSelectionChange = vi.fn();
    const onEditorReady = vi.fn();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOMClient.createRoot(container);

    act(() => {
      root.render(
        React.createElement(DocumentEditor, {
          content: null,
          onUpdateDoc,
          onSelectionChange,
          onEditorReady,
        }),
      );
    });

    expect(setContent).not.toHaveBeenCalled();

    act(() => {
      root.render(
        React.createElement(DocumentEditor, {
          content: loadedContent,
          onUpdateDoc,
          onSelectionChange,
          onEditorReady,
        }),
      );
    });

    expect(setContent).toHaveBeenCalledWith(loadedContent, { emitUpdate: false });
  });
});
