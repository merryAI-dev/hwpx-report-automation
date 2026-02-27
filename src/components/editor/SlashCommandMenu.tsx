"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import type { SlashCommandItem } from "@/lib/editor/slash-commands";

type SlashCommandMenuProps = {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
};

export type SlashCommandMenuRef = {
  onKeyDown: (event: KeyboardEvent) => boolean;
};

export const SlashCommandMenu = forwardRef<SlashCommandMenuRef, SlashCommandMenuProps>(
  function SlashCommandMenu({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(items.length - 1, 0)));

    const selectItem = (index: number) => {
      const item = items[index];
      if (!item) {
        return;
      }
      command(item);
    };

    const onArrowUp = () => {
      if (!items.length) {
        return;
      }
      setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
    };

    const onArrowDown = () => {
      if (!items.length) {
        return;
      }
      setSelectedIndex((prev) => (prev + 1) % items.length);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "ArrowUp") {
          onArrowUp();
          return true;
        }
        if (event.key === "ArrowDown") {
          onArrowDown();
          return true;
        }
        if (event.key === "Enter") {
          selectItem(safeSelectedIndex);
          return true;
        }
        return false;
      },
    }));

    const onClickItem = (index: number) => {
      selectItem(index);
    };

    const onMouseEnterItem = (index: number) => {
      setSelectedIndex(index);
    };

    const onMouseDownItem = (event: { preventDefault: () => void }) => {
      event.preventDefault();
    };

    if (!items.length) {
      return (
        <div className="slash-command-menu">
          <div className="slash-command-empty">명령어가 없습니다.</div>
        </div>
      );
    }

    return (
      <div className="slash-command-menu">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={index === safeSelectedIndex ? "slash-command-item active" : "slash-command-item"}
            onClick={() => onClickItem(index)}
            onMouseEnter={() => onMouseEnterItem(index)}
            onMouseDown={onMouseDownItem}
          >
            <strong>{item.title}</strong>
            <small>{item.description}</small>
          </button>
        ))}
      </div>
    );
  },
);
