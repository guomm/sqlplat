import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("结果仅当前页排序：倒序、正序、取消、翻页和语句切换", async ({ page }) => {
  const password =
    process.env.E2E_PASSWORD ||
    readFileSync("../.local/admin-access.txt", "utf-8")
      .split("\n")
      .find((line) => line.startsWith("密码："))!
      .slice(3);
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  let reads = 0;
  page.on("request", (request) => {
    if (/\/results\/\d+$/.test(new URL(request.url()).pathname)) reads++;
  });
  await page.goto("./");
  await page
    .getByLabel("账号", { exact: true })
    .fill(process.env.E2E_USERNAME || "admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("combobox", { name: "数据库连接" }).click();
  await page.getByText("本地 MySQL", { exact: false }).last().click();
  const editor = page.locator(".monaco-editor textarea");
  await editor.focus();
  await page.keyboard.press(`${modifier}+A`);
  const values = [2, 0, 1, ...Array.from({ length: 202 }, (_, i) => i + 3)];
  await page.keyboard.insertText(
    values.map((value) => `SELECT ${value} AS n`).join(" UNION ALL ") +
      "; SELECT 9 AS m;",
  );
  await page.keyboard.press(`${modifier}+A`);
  await page.getByRole("button", { name: "执行 SQL", exact: true }).click();
  const header = page.getByRole("columnheader", { name: "n", exact: true });
  const firstValue = page
    .locator(".result-table tbody tr")
    .first()
    .locator("td")
    .nth(1);
  await expect(firstValue).toHaveText("2");
  const initialReads = reads;
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "descending");
  await expect(firstValue).toHaveText("99");
  await page.screenshot({ path: "../.local/result-sort.png", fullPage: true });
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await expect(firstValue).toHaveText("0");
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", "none");
  await expect(firstValue).toHaveText("2");
  expect(reads).toBe(initialReads);
  // Dragging column width must not activate sorting.
  const handle = await header.locator(".resize-handle").boundingBox();
  await page.mouse.move(handle!.x + 2, handle!.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 32, handle!.y + 5);
  await page.mouse.up();
  await expect(header).toHaveAttribute("aria-sort", "none");
  await header.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(firstValue).toHaveText("99");
  await page.getByRole("listitem", { name: "2", exact: true }).click();
  await expect(firstValue).toHaveText("100");
  await expect(header).toHaveAttribute("aria-sort", "none");
  await page.getByRole("listitem", { name: "1", exact: true }).click();
  await expect(firstValue).toHaveText("2");
  await expect(header).toHaveAttribute("aria-sort", "none");
  await header.getByRole("button").click();
  await page.getByRole("tab", { name: /语句 2/ }).click();
  await expect(
    page.getByRole("columnheader", { name: "m", exact: true }),
  ).toHaveAttribute("aria-sort", "none");
  await page.getByRole("tab", { name: /语句 1/ }).click();
  await expect(firstValue).toHaveText("2");
  await expect(header).toHaveAttribute("aria-sort", "none");
});
