import { describe, expect, it } from "vitest";
import { getCsvHeaders, parseCsv } from "./csv-parser";

describe("csv-parser", () => {
  it("parses quoted fields and skips empty rows", () => {
    const input = [
      'name,notes,status',
      '"Acme, Inc.","line1',
      'line2",완료',
      ',,',
      'Beta,"""quoted"" value",종료',
    ].join("\n");

    expect(getCsvHeaders(input)).toEqual(["name", "notes", "status"]);
    expect(parseCsv(input)).toEqual([
      { name: "Acme, Inc.", notes: "line1\nline2", status: "완료" },
      { name: "Beta", notes: '"quoted" value', status: "종료" },
    ]);
  });
});
