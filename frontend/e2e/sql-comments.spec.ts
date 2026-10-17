import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("SQL 注释快捷键：全文、选中行、当前行与撤销", async ({ page }) => {
  const password =
    process.env.E2E_PASSWORD ||
    readFileSync("../.local/admin-access.txt", "utf-8")
      .split("\n")
      .find((line) => line.startsWith("密码："))!
      .slice(3);
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  let executions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/sqlplat/api/executions"
    )
      executions++;
  });
  await page.goto("./");
  await page
    .getByLabel("账号", { exact: true })
    .fill(process.env.E2E_USERNAME || "admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  const editor = page.locator(".monaco-editor textarea");
  const lines = page.locator(".monaco-editor .view-lines .view-line");
  await editor.focus();
  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.insertText("SELECT 1;\nSELECT 2;\nSELECT 3;");
  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.press(`${modifier}+Slash`);
  await expect(lines).toHaveText([
    /--\s+SELECT\s+1;/,
    /--\s+SELECT\s+2;/,
    /--\s+SELECT\s+3;/,
  ]);
  await page.keyboard.press(`${modifier}+Slash`);
  await expect(lines).toHaveText(["SELECT 1;", "SELECT 2;", "SELECT 3;"]);
  await page.keyboard.press(`${modifier}+Z`);
  await expect(lines).toHaveText([
    /--\s+SELECT\s+1;/,
    /--\s+SELECT\s+2;/,
    /--\s+SELECT\s+3;/,
  ]);
  await page.keyboard.press(`${modifier}+Z`);
  await expect(lines).toHaveText(["SELECT 1;", "SELECT 2;", "SELECT 3;"]);

  // Ending at the start of line 3 must only change lines 1 and 2.
  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press(`${modifier}+Slash`);
  await expect(lines).toHaveText([
    /--\s+SELECT\s+1;/,
    /--\s+SELECT\s+2;/,
    "SELECT 3;",
  ]);
  await page.keyboard.press(`${modifier}+Slash`);
  await expect(lines).toHaveText(["SELECT 1;", "SELECT 2;", "SELECT 3;"]);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press(`${modifier}+Slash`);
  await expect(lines).toHaveText([
    "SELECT 1;",
    "SELECT 2;",
    /--\s+SELECT\s+3;/,
  ]);
  await page.keyboard.press(`${modifier}+Slash`);
  await expect(lines).toHaveText(["SELECT 1;", "SELECT 2;", "SELECT 3;"]);

  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.insertText("  SELECT 1;\n\n  SELECT 2;");
  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.press(`${modifier}+Slash`);
  await expect(lines).toHaveText([
    /^\s+--\s+SELECT\s+1;$/,
    /^\s*$/,
    /^\s+--\s+SELECT\s+2;$/,
  ]);
  await page.keyboard.press(`${modifier}+Slash`);
  await expect(lines).toHaveText([
    /^\s+SELECT\s+1;$/,
    /^\s*$/,
    /^\s+SELECT\s+2;$/,
  ]);
  expect(executions).toBe(0);
  await expect(page.locator(".editor-status")).toContainText("/ 注释");
});
