import { expect, it } from "vitest";
import { sortRows } from "./sortRows";

it("倒序、正序与取消排序，NULL 始终在最后且不改变原数据", () => {
  const rows = [[2], [null], [10], [1]];
  expect(sortRows(rows, 0, 8, "desc")).toEqual([[10], [2], [1], [null]]);
  expect(sortRows(rows, 0, 8, "asc")).toEqual([[1], [2], [10], [null]]);
  expect(rows).toEqual([[2], [null], [10], [1]]);
});

it("长整数和小数按真实精度比较，支持负数、零和科学计数法", () => {
  const values = [
    "9007199254740993",
    "9007199254740992",
    "1.000000000000000002",
    "1.000000000000000001",
    "1e-18",
    "0",
    "-0",
    "-2",
    "-10",
  ];
  expect(
    sortRows(
      values.map((v) => [v]),
      0,
      246,
      "asc",
    ).flat(),
  ).toEqual([
    "-10",
    "-2",
    "0",
    "-0",
    "1e-18",
    "1.000000000000000001",
    "1.000000000000000002",
    "9007199254740992",
    "9007199254740993",
  ]);
});

it("文本列不会将数字文本转为数值，重复列名按位置排序，等值保持原顺序", () => {
  const rows = [
    ["a", "2"],
    ["a", "10"],
    ["b", "1"],
  ];
  expect(sortRows(rows, 1, 253, "asc")).toEqual([rows[2], rows[1], rows[0]]);
  expect(sortRows(rows, 0, 253, "desc")).toEqual([rows[2], rows[0], rows[1]]);
  expect(sortRows([["2026-10-17"], ["2026-01-01"]], 0, 10, "asc")[0][0]).toBe(
    "2026-01-01",
  );
});
