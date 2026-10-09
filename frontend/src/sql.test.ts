import { describe, it, expect } from "vitest";
import cases from "../../shared/sql-cases.json";
import { splitStatements, executionText } from "./sql";
describe("SQL 范围", () => {
  for (const c of cases)
    it(c.input, () =>
      expect(splitStatements(c.input).map((p) => p.sql)).toEqual(c.expected),
    );
  it("当前语句跨多行且不受注释分号影响", () => {
    const sql = "SELECT 1;\n-- a;\nSELECT\n 2;";
    expect(executionText("current", sql, "", sql.indexOf(" 2"))).toBe(
      "-- a;\nSELECT\n 2",
    );
  });
  it("选中内容只执行选区", () =>
    expect(
      executionText("selection", "SELECT 1; SELECT 2", "SELECT 2", 0),
    ).toBe("SELECT 2"));
  it("空选区不回退到全部", () =>
    expect(executionText("selection", "SELECT 1", "", 0)).toBe(""));
  it("全文保持原文", () =>
    expect(executionText("all", "SELECT 1; SELECT 2;", "", 0)).toBe(
      "SELECT 1; SELECT 2;",
    ));
  it("未闭合内容不提交", () =>
    expect(() => splitStatements("SELECT 'oops")).toThrow());
});

describe("自动执行范围", () => {
  it("有选区仅执行选区", () =>
    expect(executionText("auto", "SELECT 1; SELECT 2;", "SELECT 2;", 0)).toBe(
      "SELECT 2;",
    ));
  it("全选执行全文", () =>
    expect(
      executionText("auto", "SELECT 1; SELECT 2;", "SELECT 1; SELECT 2;", 0),
    ).toBe("SELECT 1; SELECT 2;"));
  it("无选区执行光标所在跨行语句", () =>
    expect(executionText("auto", "SELECT 1;\nSELECT\n 2;", "", 18)).toBe(
      "SELECT\n 2",
    ));
});
