import { Extension } from "@tiptap/core";
import "@tiptap/extension-text-style";

export type FontSizeOptions = {
  types: string[];
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

/**
 * TextStyle 마크에 fontSize + HWPX 라운드트립용 속성을 등록하는 확장.
 *
 * TipTap의 TextStyle은 기본적으로 color만 지원하므로,
 * fontSize / hwpxUnderlineType / hwpxStrikeShape를 글로벌 속성으로 추가해야
 * import → 편집 → export 사이클에서 속성이 유실되지 않는다.
 */
export const FontSize = Extension.create<FontSizeOptions>({
  name: "fontSize",

  addOptions() {
    return { types: ["textStyle"] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize?.replace(/['"]+/g, "") || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
          // HWPX 밑줄 변형 (DOUBLE, DOTTED 등) — 라운드트립 보존용, 렌더링 없음
          hwpxUnderlineType: {
            default: null,
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
          // HWPX 취소선 변형 (DOUBLE 등) — 라운드트립 보존용, 렌더링 없음
          hwpxStrikeShape: {
            default: null,
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});
