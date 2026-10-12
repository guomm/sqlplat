import { afterEach, expect, it, vi } from "vitest";
import { newDraftId } from "./draftId";

const browserCrypto = globalThis.crypto;
afterEach(() => vi.unstubAllGlobals());

it("支持原生 randomUUID 的环境继续使用原生接口", () => {
  const randomUUID = vi.fn().mockReturnValue("native-id");
  vi.stubGlobal("crypto", { randomUUID });
  expect(newDraftId()).toBe("native-id");
  expect(randomUUID).toHaveBeenCalledOnce();
});

it("HTTP 缺少 randomUUID 时生成符合 v4 格式的标签 ID", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: (bytes: Uint8Array) => bytes.fill(0),
  });
  expect(newDraftId()).toBe("00000000-0000-4000-8000-000000000000");
});

it("HTTP 回退方式创建多个标签时 ID 保持不同", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto),
  });
  const ids = Array.from({ length: 100 }, () => newDraftId());
  expect(new Set(ids).size).toBe(100);
  for (const id of ids) {
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  }
});
