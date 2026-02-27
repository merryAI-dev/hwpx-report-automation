import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import FontFamily from "@tiptap/extension-font-family";
import { TextStyle } from "@tiptap/extension-text-style";
import { HwpxMetadataExtension } from "./schema";
import { SlashCommandExtension } from "./slash-commands";
import { DiffHighlightExtension } from "./diff-highlight-extension";
import { OfficePasteExtension } from "./office-paste-extension";

type EditorExtensionOptions = {
  onAiCommand?: () => void;
};

export function createEditorExtensions(options: EditorExtensionOptions = {}) {
  return [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3],
      },
    }),
    TextStyle,
    FontFamily.configure({
      types: ["textStyle"],
    }),
    Underline,
    TextAlign.configure({
      types: ["heading", "paragraph"],
    }),
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({
      placeholder: "문서 내용을 입력하세요. # 으로 커맨드를 열 수 있습니다.",
    }),
    HwpxMetadataExtension,
    SlashCommandExtension.configure({
      onAiCommand: options.onAiCommand,
    }),
    DiffHighlightExtension,
    OfficePasteExtension,
  ];
}
