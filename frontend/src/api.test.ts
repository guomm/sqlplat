import { afterEach, expect, it, vi } from "vitest";
import { api, apiUrl } from "./api";
afterEach(() => vi.unstubAllGlobals());
it("API 与下载 URL 使用平台前缀", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  await api("/auth/me");
  expect(fetch.mock.calls[0][0]).toBe("/sqlplat/api/auth/me");
  expect(apiUrl("/executions/test/results/1/download?format=csv")).toBe(
    "/sqlplat/api/executions/test/results/1/download?format=csv",
  );
});
it("成功删除的 204 响应不解析空 JSON", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  );
  await expect(
    api("/saved-queries/test", { method: "DELETE" }),
  ).resolves.toBeUndefined();
});
