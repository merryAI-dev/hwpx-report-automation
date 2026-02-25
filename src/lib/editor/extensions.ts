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
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Transaction, EditorState } from "@tiptap/pm/state";
import { HwpxMetadataExtension } from "./schema";
import { SlashCommandExtension } from "./slash-commands";
import { DiffHighlightExtension } from "./diff-highlight-extension";
import { OfficePasteExtension } from "./office-paste-extension";
import { CustomHeading } from "./custom-heading";
import BubbleMenu from "@tiptap/extension-bubble-menu";
import { synthesizeParaNode } from "./para-synthesizer";
import type { HwpxDocumentModel } from "../../types/hwpx-model";

type EditorExtensionOptions = {
  onAiCommand?: () => void;
  onNewParaCreated?: (paraId: string, sectionFileName: string) => void;
  getHwpxDocumentModel?: () => HwpxDocumentModel | null;
};

const HwpxParaAutoAssignKey = new PluginKey("hwpxParaAutoAssign");

function createHwpxParaAutoAssignPlugin(
  getHwpxDocumentModel: () => HwpxDocumentModel | null,
  onNewParaCreated: (paraId: string, fileName: string) => void,
) {
  return new Plugin({
    key: HwpxParaAutoAssignKey,
    appendTransaction(
      transactions: readonly Transaction[],
      _oldState: EditorState,
      newState: EditorState,
    ): Transaction | null {
      // docChanged가 없으면 스킵 (타이핑 최적화)
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const model = getHwpxDocumentModel();
      if (!model) return null;

      let tr: Transaction | null = null;

      newState.doc.descendants((node, pos) => {
        if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
        if (node.attrs.paraId) return true; // 이미 할당됨

        // 가장 가까운 형제에서 fileName, paraId 탐색
        let siblingParaId: string | null = null;
        let sectionFileName = model.sections[0]?.fileName ?? "Contents/section0.xml";

        // 이전/다음 형제 중 paraId가 있는 첫 번째 노드 선택
        newState.doc.descendants((sibling, _siblingPos) => {
          if (sibling === node) return false;
          if (sibling.type.name !== "paragraph" && sibling.type.name !== "heading") return true;
          if (!sibling.attrs.paraId) return true;
          siblingParaId = sibling.attrs.paraId as string;
          sectionFileName = (sibling.attrs.fileName as string) || sectionFileName;
          return false; // 첫 번째 발견 후 중단
        });

        const siblingPara = siblingParaId ? model.paraStore.get(siblingParaId) : null;
        const newParaId = crypto.randomUUID();

        // 1. paraStore에 새 노드 등록
        const newPara = synthesizeParaNode(siblingPara ?? null, newParaId, sectionFileName);
        model.paraStore.set(newParaId, newPara);

        // 2. section.blocks에 sibling 다음에 슬롯 삽입
        for (const section of model.sections) {
          if (section.fileName !== sectionFileName) continue;
          const sibIdx = section.blocks.findIndex(
            (b) => b.type === "para" && b.paraId === siblingParaId,
          );
          const insertAt = sibIdx >= 0 ? sibIdx + 1 : section.blocks.length;
          section.blocks.splice(insertAt, 0, {
            type: "para",
            paraId: newParaId,
            leadingWhitespace: "\n  ",
          });
          break;
        }

        // 3. ProseMirror 트랜잭션: paraId attr 설정
        if (!tr) tr = newState.tr;
        tr = tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          paraId: newParaId,
          fileName: sectionFileName,
        });

        onNewParaCreated(newParaId, sectionFileName);
        return true;
      });

      return tr;
    },
  });
}

export function createEditorExtensions(options: EditorExtensionOptions = {}) {
  const {
    onAiCommand,
    onNewParaCreated = () => {},
    getHwpxDocumentModel = () => null,
  } = options;

  return [
    StarterKit.configure({
      heading: false, // 기본 헤딩 끔
    }),
    CustomHeading.configure({
      levels: [1, 2, 3, 4, 5],
    }),
    BubbleMenu,
    TextStyle,
    Color.configure({ types: ["textStyle"] }),
    Highlight.configure({ multicolor: true }),
    FontFamily.configure({
      types: ["textStyle"],
    }),
    Underline,
    Superscript,
    Subscript,
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
    Extension.create({
      name: "hwpxParaAutoAssign",
      addProseMirrorPlugins() {
        return [createHwpxParaAutoAssignPlugin(getHwpxDocumentModel, onNewParaCreated)];
      },
    }),
  ];
}
