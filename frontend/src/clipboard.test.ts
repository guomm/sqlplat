import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => undefined });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});
it("uses the clipboard API when available", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(navigator, "clipboard", "get").mockReturnValue({
    writeText,
  } as unknown as Clipboard);
  await copyText("中文\n123");
  expect(writeText).toHaveBeenCalledWith("中文\n123");
});
it("HTTP fallback copies exact text and restores focus", async () => {
  vi.spyOn(navigator, "clipboard", "get").mockReturnValue(
    undefined as unknown as Clipboard,
  );
  const button = document.createElement("button");
  document.body.appendChild(button);
  button.focus();
  const copy = vi.fn(() => {
    expect((document.activeElement as HTMLTextAreaElement).value).toBe(
      "中文\n9007199254740993",
    );
    return true;
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: copy,
  });
  await copyText("中文\n9007199254740993");
  expect(copy).toHaveBeenCalledWith("copy");
  expect(document.activeElement).toBe(button);
  expect(document.querySelector("textarea")).toBeNull();
});
it("reports failure and cleans up when both methods fail", async () => {
  vi.spyOn(navigator, "clipboard", "get").mockReturnValue({
    writeText: vi.fn().mockRejectedValue(new Error()),
  } as unknown as Clipboard);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn(() => false),
  });
  await expect(copyText("NULL")).rejects.toThrow();
  expect(document.querySelector("textarea")).toBeNull();
});
