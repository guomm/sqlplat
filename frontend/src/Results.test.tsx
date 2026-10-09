import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { App, ConfigProvider } from "antd";
import Results from "./Results";
import type { Task } from "./types";
Object.defineProperty(window, "matchMedia", {
  value: () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }),
});
const task: Task = {
  id: "task",
  connection_id: 1,
  connection_name: "MySQL",
  database: "db",
  sql: "SELECT 1",
  status: "success",
  created_at: "2026-10-09T01:00:00",
  started_at: null,
  ended_at: null,
  elapsed_ms: 10,
  error: "",
  statements: [
    {
      id: 1,
      ordinal: 0,
      sql: "SELECT 1",
      status: "success",
      columns: [
        { name: "x", type: 8 },
        { name: "x", type: 8 },
      ],
      affected_rows: 0,
      saved_rows: 1,
      truncated: true,
      expires_at: null,
      elapsed_ms: 10,
      error: "",
    },
  ],
};
const wrap = (t: Task | null) =>
  render(
    <ConfigProvider>
      <App>
        <Results task={t} />
      </App>
    </ConfigProvider>,
  );
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("结果展示", () => {
  it("空工作台显示执行引导", () => {
    wrap(null);
    expect(screen.getByText("结果将在这里呈现")).toBeInTheDocument();
  });
  it("保留重复列名、长整数及 NULL，并标明截断", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          columns: task.statements[0].columns,
          rows: [["9007199254740993", null]],
          total: 1,
          saved_rows: 1,
          truncated: true,
        }),
        { status: 200 },
      ),
    );
    wrap(task);
    await waitFor(() =>
      expect(screen.getByText("9007199254740993")).toBeInTheDocument(),
    );
    expect(screen.getAllByRole("columnheader", { name: "x" })).toHaveLength(2);
    expect(screen.getByText("NULL")).toBeInTheDocument();
    expect(screen.getByText(/结果已截断/)).toBeInTheDocument();
  });
  it("过期结果提示且禁用下载", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "结果已过期" }), { status: 410 }),
    );
    wrap(task);
    await screen.findByText("结果已过期");
    expect(screen.getByRole("button", { name: "下载 CSV" })).toBeDisabled();
  });
});
