import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export type DiffHighlightSuggestion = {
  segmentId: string;
  originalText: string;
  suggestion: string;
  decision?: "accepted" | "rejected" | undefined;
};

const DIFF_HIGHLIGHT_PLUGIN_KEY = new PluginKey<DecorationSet>("diffHighlight");
const DIFF_HIGHLIGHT_META = "diffHighlightUpdate";

function buildDecorations(
  doc: PMNode,
  suggestions: DiffHighlightSuggestion[],
): DecorationSet {
  if (!suggestions.length) {
    return DecorationSet.empty;
  }

  const suggestionMap = new Map<string, DiffHighlightSuggestion>();
  for (const s of suggestions) {
    suggestionMap.set(s.segmentId, s);
  }

  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") {
      return true;
    }
    const attrs = node.attrs as { segmentId?: string };
    if (!attrs.segmentId || !suggestionMap.has(attrs.segmentId)) {
      return true;
    }

    const suggestion = suggestionMap.get(attrs.segmentId)!;
    let cssClass = "diff-pending";
    if (suggestion.decision === "accepted") {
      cssClass = "diff-accepted";
    } else if (suggestion.decision === "rejected") {
      cssClass = "diff-rejected";
    }

    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: cssClass,
        "data-diff-segment": attrs.segmentId,
      }),
    );

    return true;
  });

  return DecorationSet.create(doc, decorations);
}

export const DiffHighlightExtension = Extension.create({
  name: "diffHighlight",

  addStorage() {
    return {
      suggestions: [] as DiffHighlightSuggestion[],
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin<DecorationSet>({
        key: DIFF_HIGHLIGHT_PLUGIN_KEY,

        state: {
          init(_, state) {
            return buildDecorations(state.doc, extension.storage.suggestions);
          },
          apply(tr, oldDecorations, _oldState, newState) {
            if (tr.getMeta(DIFF_HIGHLIGHT_META) || tr.docChanged) {
              return buildDecorations(newState.doc, extension.storage.suggestions);
            }
            return oldDecorations.map(tr.mapping, tr.doc);
          },
        },

        props: {
          decorations(state) {
            return DIFF_HIGHLIGHT_PLUGIN_KEY.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

export function triggerDiffHighlightUpdate(editor: Editor): void {
  const tr = editor.state.tr.setMeta(DIFF_HIGHLIGHT_META, true);
  editor.view.dispatch(tr);
}
