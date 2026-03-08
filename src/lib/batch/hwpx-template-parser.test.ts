import { describe, expect, it } from "vitest";
import { buildFieldCoordMap, parseHwpxTemplate } from "./hwpx-template-parser";

const SECTION_XML = `
<root>
  <hp:tc colAddr="0" rowAddr="0" colSpan="1" rowSpan="1">
    <hp:subList><hp:p><hp:run><hp:t>주제</hp:t></hp:run></hp:p></hp:subList>
  </hp:tc>
  <hp:tc colAddr="1" rowAddr="0" colSpan="1" rowSpan="1">
    <hp:subList><hp:p><hp:run><hp:t></hp:t></hp:run></hp:p></hp:subList>
  </hp:tc>
  <hp:tc colAddr="0" rowAddr="1" colSpan="1" rowSpan="1">
    <hp:subList><hp:p><hp:run><hp:t>참여자</hp:t></hp:run></hp:p></hp:subList>
  </hp:tc>
  <hp:tc colAddr="1" rowAddr="1" colSpan="1" rowSpan="1">
    <hp:subList><hp:p><hp:run><hp:t></hp:t></hp:run></hp:p></hp:subList>
  </hp:tc>
</root>
`;

describe("hwpx-template-parser", () => {
  it("detects adjacent label and input cells", () => {
    const parsed = parseHwpxTemplate(SECTION_XML);
    const coordMap = buildFieldCoordMap(parsed);

    expect(parsed.fields).toHaveLength(2);
    expect(coordMap.get("topic")).toEqual({ col: 1, row: 0 });
    expect(coordMap.get("participants")).toEqual({ col: 1, row: 1 });
  });
});
