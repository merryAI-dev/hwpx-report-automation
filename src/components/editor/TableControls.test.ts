import { act } from "react";
import React from "react";
import ReactDOMClient from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableControls } from "./TableControls";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TableControls", () => {
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
  });

  it("renders a delete row action and wires it to the editor command chain", () => {
    const chain = {
      focus: vi.fn(() => chain),
      insertTable: vi.fn(() => chain),
      addRowAfter: vi.fn(() => chain),
      addColumnAfter: vi.fn(() => chain),
      deleteRow: vi.fn(() => chain),
      deleteTable: vi.fn(() => chain),
      run: vi.fn(() => true),
    };

    const editor = {
      can: () => ({
        addRowAfter: () => true,
        addColumnAfter: () => true,
        deleteRow: () => true,
        deleteTable: () => true,
      }),
      chain: () => chain,
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOMClient.createRoot(container);

    act(() => {
      root.render(
        React.createElement(TableControls, {
          editor: editor as never,
          groupClassName: "toolbar-group",
          buttonClassName: "toolbar-button",
        }),
      );
    });

    const deleteRowButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "행 삭제",
    );

    expect(deleteRowButton).toBeTruthy();

    act(() => {
      deleteRowButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(chain.focus).toHaveBeenCalled();
    expect(chain.deleteRow).toHaveBeenCalled();
    expect(chain.run).toHaveBeenCalled();
  });
});
