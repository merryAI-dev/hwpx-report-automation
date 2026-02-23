import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Cleans up HTML pasted from Microsoft Office (Word, PowerPoint, Excel).
 * Removes mso-* styles, conditional comments, and normalizes the HTML
 * so TipTap can parse it correctly.
 */
export const OfficePasteExtension = Extension.create({
  name: "officePaste",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("officePaste"),
        props: {
          transformPastedHTML(html: string): string {
            // Detect Office HTML by mso- styles or xmlns:o
            if (!html.includes("mso-") && !html.includes("xmlns:o") && !html.includes("urn:schemas-microsoft-com")) {
              return html;
            }
            return cleanOfficeHtml(html);
          },
        },
      }),
    ];
  },
});

function cleanOfficeHtml(html: string): string {
  // Remove conditional comments: <!--[if ...]>...<![endif]-->
  let cleaned = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "");

  // Remove XML declarations
  cleaned = cleaned.replace(/<\?xml[\s\S]*?\?>/gi, "");

  // Remove Office-specific tags (o:p, v:*, w:*, m:*)
  cleaned = cleaned.replace(/<\/?(o|v|w|m|st\d):[^>]*>/gi, "");

  // Remove class attributes (Office generates tons of class names)
  cleaned = cleaned.replace(/\s+class\s*=\s*["'][^"']*["']/gi, "");

  // Clean style attributes: remove mso-* properties
  cleaned = cleaned.replace(/\s+style\s*=\s*["']([^"']*)["']/gi, (_match, styleContent: string) => {
    const cleanedStyle = styleContent
      .split(";")
      .map((prop: string) => prop.trim())
      .filter((prop: string) => {
        if (!prop) return false;
        // Remove mso-* properties
        if (/^mso-/i.test(prop)) return false;
        // Remove Office-specific properties
        if (/^(tab-stops|text-indent|margin-bottom:\s*\.0001pt)/i.test(prop)) return false;
        return true;
      })
      .join("; ");

    return cleanedStyle ? ` style="${cleanedStyle}"` : "";
  });

  // Remove empty spans
  cleaned = cleaned.replace(/<span\s*>\s*<\/span>/gi, "");

  // Remove &nbsp; used for spacing (common in Office HTML)
  cleaned = cleaned.replace(/&nbsp;/g, " ");

  // Remove empty paragraphs with only whitespace
  cleaned = cleaned.replace(/<p[^>]*>\s*<\/p>/gi, "");

  // Normalize <b> → <strong>, <i> → <em>
  cleaned = cleaned.replace(/<b(\s|>)/gi, "<strong$1");
  cleaned = cleaned.replace(/<\/b>/gi, "</strong>");
  cleaned = cleaned.replace(/<i(\s|>)/gi, "<em$1");
  cleaned = cleaned.replace(/<\/i>/gi, "</em>");

  return cleaned;
}
