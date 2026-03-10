import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import type { Editor, Range } from "@tiptap/core";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { SlashCommandMenu, type SlashCommandMenuRef } from "../../components/editor/SlashCommandMenu";

export type SlashCommandItem = {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  run: (params: { editor: Editor; range: Range; onAiCommand?: () => void }) => void;
};

type SlashCommandContext = {
  onAiCommand?: () => void;
};

function baseCommands(): Omit<SlashCommandItem, "run">[] {
  return [
    {
      id: "table-3x4",
      title: "표 생성 3x4",
      description: "3행 4열 표를 삽입합니다.",
      keywords: ["표", "테이블", "3x4", "insert table"],
    },
    {
      id: "ai-rewrite",
      title: "AI 수정",
      description: "현재 선택 텍스트를 AI 제안 대상으로 보냅니다.",
      keywords: ["ai", "rewrite", "수정", "제안"],
    },
    {
      id: "divider",
      title: "구분선",
      description: "수평 구분선을 삽입합니다.",
      keywords: ["구분선", "hr", "divider"],
    },
    {
      id: "image-insert",
      title: "이미지",
      description: "이미지 파일을 선택하여 삽입합니다.",
      keywords: ["이미지", "image", "사진", "그림"],
    },
    {
      id: "set-field-recipient",
      title: "필드: 수신",
      description: "현재 문단을 '수신' 필드로 지정합니다.",
      keywords: ["field", "recipient", "수신"],
    },
    {
      id: "set-field-sender",
      title: "필드: 발신",
      description: "현재 문단을 '발신' 필드로 지정합니다.",
      keywords: ["field", "sender", "발신"],
    },
    {
      id: "set-field-title",
      title: "필드: 제목",
      description: "현재 문단을 '제목' 필드로 지정합니다.",
      keywords: ["field", "title", "제목"],
    },
    {
      id: "set-field-body",
      title: "필드: 본문",
      description: "현재 문단을 '본문' 필드로 지정합니다.",
      keywords: ["field", "body", "본문"],
    },
    // Heading levels
    {
      id: "heading1",
      title: "제목1",
      description: "큰 제목(H1)을 삽입합니다.",
      keywords: ["제목1", "heading", "h1", "큰제목"],
    },
    {
      id: "heading2",
      title: "제목2",
      description: "중간 제목(H2)을 삽입합니다.",
      keywords: ["제목2", "heading", "h2", "중간제목"],
    },
    {
      id: "heading3",
      title: "제목3",
      description: "작은 제목(H3)을 삽입합니다.",
      keywords: ["제목3", "heading", "h3", "작은제목"],
    },
    // Block elements
    {
      id: "blockquote",
      title: "인용",
      description: "인용구(blockquote)를 삽입합니다.",
      keywords: ["인용", "blockquote", "quote"],
    },
    {
      id: "codeblock",
      title: "코드블록",
      description: "코드 블록을 삽입합니다.",
      keywords: ["코드블록", "code", "코드"],
    },
    {
      id: "checklist",
      title: "체크리스트",
      description: "체크박스 목록을 삽입합니다.",
      keywords: ["체크리스트", "checklist", "todo", "할일"],
    },
    // Utility
    {
      id: "date",
      title: "날짜",
      description: "오늘 날짜를 삽입합니다.",
      keywords: ["날짜", "date", "오늘"],
    },
    // AI helpers
    {
      id: "ai-summarize",
      title: "AI 요약",
      description: "현재 문단을 AI로 요약합니다.",
      keywords: ["ai", "요약", "summarize", "summary"],
    },
    {
      id: "ai-translate",
      title: "AI 번역",
      description: "현재 문단을 AI로 영어 번역합니다.",
      keywords: ["ai", "번역", "translate", "translation"],
    },
  ];
}

export function getSlashCommandItems(query: string, context: SlashCommandContext): SlashCommandItem[] {
  const q = query.trim().toLowerCase();
  const commands: SlashCommandItem[] = baseCommands().map((command) => ({
    ...command,
    run: ({ editor, range, onAiCommand }) => {
      if (command.id === "table-3x4") {
        editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 4, withHeaderRow: false }).run();
        return;
      }
      if (command.id === "ai-rewrite") {
        editor.chain().focus().deleteRange(range).run();
        const aiHandler = onAiCommand || context.onAiCommand;
        aiHandler?.();
        return;
      }
      if (command.id === "divider") {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run();
        return;
      }
      if (command.id.startsWith("set-field-")) {
        const fieldType = command.id.replace("set-field-", "");
        editor.chain().focus().deleteRange(range).updateAttributes("paragraph", { fieldType }).updateAttributes("heading", { fieldType }).run();
        return;
      }
      if (command.id === "heading1") {
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run();
        return;
      }
      if (command.id === "heading2") {
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run();
        return;
      }
      if (command.id === "heading3") {
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run();
        return;
      }
      if (command.id === "blockquote") {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run();
        return;
      }
      if (command.id === "codeblock") {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
        return;
      }
      if (command.id === "checklist") {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
        return;
      }
      if (command.id === "date") {
        const today = new Date().toLocaleDateString("ko-KR");
        editor.chain().focus().deleteRange(range).insertContent(today).run();
        return;
      }
      if (command.id === "ai-summarize") {
        editor.chain().focus().deleteRange(range).run();
        const { selection } = editor.state;
        const currentNode = selection.$from.node();
        const paragraphText = currentNode.textContent;
        const aiHandler = onAiCommand || context.onAiCommand;
        if (paragraphText.trim()) {
          // Pass text as context through the AI command — onAiCommand triggers with current selection
          aiHandler?.();
        } else {
          aiHandler?.();
        }
        return;
      }
      if (command.id === "ai-translate") {
        editor.chain().focus().deleteRange(range).run();
        const aiHandler = onAiCommand || context.onAiCommand;
        aiHandler?.();
        return;
      }
      // Trigger toolbar image file picker
      editor.chain().focus().deleteRange(range).run();
      const imageInput = document.querySelector<HTMLInputElement>('input[data-image-input]');
      if (imageInput) {
        imageInput.click();
      }
    },
  }));

  if (!q) {
    return commands;
  }
  return commands.filter((command) => {
    const bucket = `${command.title} ${command.description} ${command.keywords.join(" ")}`.toLowerCase();
    return bucket.includes(q);
  });
}

type SlashSuggestionProps = SuggestionProps<SlashCommandItem, SlashCommandItem>;
type SlashCommandMenuProps = {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
};

export const SlashCommandExtension = Extension.create<SlashCommandContext>({
  name: "slashCommand",
  addOptions() {
    return {
      onAiCommand: undefined,
    };
  },
  addProseMirrorPlugins() {
    const context = this.options;
    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        char: "#",
        allowSpaces: true,
        startOfLine: false,
        items: ({ query }) => getSlashCommandItems(query, context),
        command: ({ editor, range, props }) => {
          props.run({ editor, range, onAiCommand: context.onAiCommand });
        },
        render: () => {
          let component: ReactRenderer<SlashCommandMenuRef, SlashCommandMenuProps> | null = null;
          let popup: TippyInstance | null = null;

          return {
            onStart: (props: SlashSuggestionProps) => {
              const menuProps: SlashCommandMenuProps = {
                items: props.items,
                command: props.command,
              };
              component = new ReactRenderer(SlashCommandMenu, {
                props: menuProps,
                editor: props.editor,
              });

              if (!props.clientRect) {
                return;
              }

              popup = tippy(document.body, {
                getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
              });
            },
            onUpdate(props: SlashSuggestionProps) {
              const menuProps: SlashCommandMenuProps = {
                items: props.items,
                command: props.command,
              };
              component?.updateProps(menuProps);
              if (!props.clientRect || !popup) {
                return;
              }
              popup.setProps({
                getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
              });
            },
            onKeyDown(props: SuggestionKeyDownProps) {
              if (props.event.key === "Escape") {
                popup?.hide();
                return true;
              }
              return component?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit() {
              popup?.destroy();
              popup = null;
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
