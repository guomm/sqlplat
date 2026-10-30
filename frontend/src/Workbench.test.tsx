import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Workbench from "./Workbench";
import { api } from "./api";

vi.mock("./SqlEditor", () => ({ default: () => <div>Editor</div> }));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
}));
beforeEach(() => {
  localStorage.clear();
  vi.mocked(api).mockClear();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const computed = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    computed(element),
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(kind = "postgresql") {
  localStorage.setItem(
    "sqlplat-drafts-1",
    JSON.stringify([
      {
        id: "draft",
        name: "Query",
        sql: "SELECT 1",
        connection: 1,
        database: "db",
      },
    ]),
  );
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/connections")
      return [{ id: 1, name: "test", kind, database: "db", enabled: true }];
    if (path.includes("/databases")) return ["db", "db2"];
    if (path.includes("/schemas"))
      return path.includes("database=db2")
        ? ["analytics"]
        : ["analytics", "public"];
    if (path.includes("/tables"))
      return path.includes("schema=analytics")
        ? ["analytics.orders"]
        : ["public.users"];
    throw new Error(path);
  });
  render(
    <App>
      <Workbench
        user={{ id: 1, username: "admin", role: "admin", enabled: true }}
        restore=""
        savedRestore=""
        onRestored={vi.fn()}
        onSavedRestored={vi.fn()}
      />
    </App>,
  );
}
it("PG defaults to public and changing schema filters tables", async () => {
  mount();
  await screen.findByText("users");
  expect(screen.queryByText("public.users")).not.toBeInTheDocument();
  expect(
    vi
      .mocked(api)
      .mock.calls.filter(([path]) => path.includes("/tables"))
      .every(([path]) => path.includes("schema=public")),
  ).toBe(true);
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Schema" }));
  fireEvent.click(
    await screen.findByText("analytics", {
      selector: ".ant-select-item-option-content",
    }),
  );
  await screen.findByText("orders");
  expect(screen.queryByText("users")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem("sqlplat-drafts-1")!)[0].schema,
    ).toBe("analytics"),
  );
});
it("MySQL keeps the database/table flow without a schema control", async () => {
  mount("mysql");
  await screen.findByText("public.users");
  expect(
    screen.queryByRole("combobox", { name: "Schema" }),
  ).not.toBeInTheDocument();
  expect(
    vi.mocked(api).mock.calls.some(([path]) => path.includes("/schemas")),
  ).toBe(false);
});

it("changing databases reloads schemas and falls back when public is absent", async () => {
  mount();
  await screen.findByText("users");
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "数据库" }));
  fireEvent.click(
    await screen.findByText("db2", {
      selector: ".ant-select-item-option-content",
    }),
  );
  await screen.findByText("orders");
  await waitFor(() =>
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) =>
          path.includes("database=db2&schema=analytics"),
        ),
    ).toBe(true),
  );
  expect(
    vi
      .mocked(api)
      .mock.calls.filter(
        ([path]) => path.includes("/tables") && path.includes("database=db2"),
      )
      .every(([path]) => path.includes("schema=analytics")),
  ).toBe(true);
});
