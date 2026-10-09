import { describe, expect, it } from "vitest";
import { formatSql } from "./formatSql";

describe("SQL 格式化", () => {
  it("调整缩进和关键字，同时保留字符串、注释和带引号标识符", () => {
    const formatted = formatSql(
      "select `a;b`, '中文;select' from t where id=1; -- 保留注释",
    );
    expect(formatted).toContain("SELECT\n");
    expect(formatted).toContain("`a;b`");
    expect(formatted).toContain("'中文;select'");
    expect(formatted).toContain("-- 保留注释");
    expect(formatSql(formatted)).toBe(formatted);
  });
  it("格式化多条语句", () => {
    expect(formatSql("select 1;select 2;").match(/SELECT/g)).toHaveLength(2);
  });
  it("未闭合字符串报告错误", () => {
    expect(() => formatSql("select 'unfinished")).toThrow();
  });
});
