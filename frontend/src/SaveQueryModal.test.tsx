import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SaveQueryModal from "./SaveQueryModal";
import { api } from "./api";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
vi.mock("./api", () => ({
  api: vi.fn(),
  send: (method: string, body: unknown) => ({
    method,
    body: JSON.stringify(body),
  }),
}));
beforeEach(() => {
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
it("请求期间重复提交不会创建两条 SQL", async () => {
  vi.mocked(api).mockImplementation(() => new Promise(() => {}));
  render(
    <App>
      <SaveQueryModal
        snapshot={{
          draftId: "source",
          name: "查询",
          sql: "SELECT 1",
          connection_id: null,
          database: "",
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    </App>,
  );
  const form = screen.getByLabelText("名称").closest("form")!;
  fireEvent.submit(form);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  fireEvent.submit(form);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(api).toHaveBeenCalledTimes(1);
});
it("保存期间 Escape 不关闭弹窗", async () => {
  vi.mocked(api)
    .mockReset()
    .mockImplementation(() => new Promise(() => {}));
  const close = vi.fn();
  render(
    <App>
      <SaveQueryModal
        snapshot={{
          draftId: "source",
          name: "查询",
          sql: "SELECT 1",
          connection_id: null,
          database: "",
        }}
        onClose={close}
        onSaved={vi.fn()}
      />
    </App>,
  );
  fireEvent.submit(screen.getByLabelText("名称").closest("form")!);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", keyCode: 27 });
  expect(close).not.toHaveBeenCalled();
});
