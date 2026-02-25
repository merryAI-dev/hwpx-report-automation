import { Heading as TiptapHeading } from "@tiptap/extension-heading";
import { textblockTypeInputRule } from "@tiptap/core";

export const CustomHeading = TiptapHeading.extend({
  addInputRules() {
    return this.options.levels.map(level => {
      // 매칭될 필드 타입 정의
      const fieldMap: Record<number, string> = {
        1: "title",
        2: "recipient",
        3: "sender",
        4: "body",
        5: "reference"
      };

      return textblockTypeInputRule({
        find: new RegExp(`^(#{1,${level}})\s$`),
        type: this.type,
        getAttributes: {
          level,
          fieldType: fieldMap[level] || null
        },
      });
    });
  },
});
