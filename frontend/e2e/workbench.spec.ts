import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const credentials = readFileSync("../.local/admin-access.txt", "utf-8");
const password =
  process.env.E2E_PASSWORD ||
  credentials
    .split("\n")
    .find((line) => line.startsWith("密码："))!
    .slice(3);

test("真实 MySQL：登录、库表、三种执行范围、下载、历史与退出", async ({
  page,
}) => {
  const errors: string[] = [];
  const requestedPaths: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) =>
    requestedPaths.push(new URL(request.url()).pathname),
  );
  await page.goto("./");
  await page
    .getByLabel("账号", { exact: true })
    .fill(process.env.E2E_USERNAME || "admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByText("查询工作台", { exact: false })).toBeVisible();
  await page.getByRole("combobox", { name: "数据库连接" }).click();
  await page.getByText("本地 MySQL", { exact: false }).last().click();
  await expect(
    page.getByText("atelier_demo_orders", { exact: true }),
  ).toBeVisible();
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "sqlplat_session",
  );
  expect(sessionCookie?.path).toBe("/sqlplat/");
  expect(
    requestedPaths.some((path) =>
      /^\/(?:api|src|assets|node_modules)\//.test(path),
    ),
  ).toBe(false);
  await page.locator(".ant-tree-switcher").first().click();
  await expect(page.getByText("amount", { exact: true })).toBeVisible();
  const editor = page.locator(".monaco-editor textarea");
  await editor.focus();
  await page.keyboard.press("Meta+A");
  await page.keyboard.insertText(
    "SELECT id, region, product, amount, ordered_at FROM atelier_demo_orders ORDER BY id;\nSELECT 42 AS answer;",
  );
  await page.keyboard.press("Meta+A");
  await page.getByRole("button", { name: "执行 SQL", exact: true }).click();
  await expect(
    page
      .locator(".result-table")
      .getByText("数据服务", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /语句 2/ })).toBeVisible();
  await page.screenshot({ path: "../.local/workbench.png", fullPage: true });
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 CSV", exact: true }).click();
  const csvDownload = await csv;
  expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/);
  await csvDownload.saveAs("../.local/e2e-result.csv");
  const csvText = readFileSync("../.local/e2e-result.csv", "utf-8");
  expect(csvText).toContain("ordered_at");
  expect(csvText).toContain("华东");
  const xlsx = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 Excel", exact: true }).click();
  const xlsxDownload = await xlsx;
  await xlsxDownload.saveAs("../.local/e2e-result.xlsx");
  expect(
    readFileSync("../.local/e2e-result.xlsx").subarray(0, 2).toString(),
  ).toBe("PK");
  await editor.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "执行 SQL", exact: true }).click();
  await expect(
    page.locator(".result-table td").filter({ hasText: /^42$/ }),
  ).toBeVisible();
  await editor.focus();
  await page.keyboard.press("Meta+A");
  await page.keyboard.insertText(
    "SELECT 7 AS selected; SELECT 9 AS unselected;",
  );
  // Select the last complete statement using actual Monaco keyboard selection.
  for (let i = 0; i < "SELECT 9 AS unselected;".length; i++)
    await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "执行 SQL", exact: true }).click();
  await expect(
    page.locator(".result-table td").filter({ hasText: /^9$/ }),
  ).toBeVisible();
  await expect(
    page.locator(".result-table th").filter({ hasText: /^unselected$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "执行历史", exact: false }).click();
  await expect(
    page.getByText("SELECT 9 AS unselected;", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "打开", exact: false })
    .first()
    .click();
  await expect(page.locator(".result-table")).toHaveCount(0);
  await editor.focus();
  await page.keyboard.press("Meta+A");
  await page.getByRole("button", { name: "执行 SQL", exact: true }).click();
  await expect(
    page.locator(".result-table td").filter({ hasText: /^9$/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".result-table td").filter({ hasText: /^9$/ }),
  ).toBeVisible();
  await page.locator(".user-menu").hover();
  await page.getByText("退出登录", { exact: true }).click();
  await expect(page.getByText("登录工作台")).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(errors).toEqual([]);
});

test("执行快捷键不会重复提交运行中的任务", async ({ page }) => {
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
  await page.keyboard.press("Meta+A");
  await page.keyboard.insertText("SELECT SLEEP(1) AS waited;");
  let submissions = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/sqlplat/api/executions"
    )
      submissions++;
  });
  await page.keyboard.press("Meta+Enter");
  await page.keyboard.press("Meta+Enter");
  await expect(
    page.locator(".result-table th").filter({ hasText: /^waited$/ }),
  ).toBeVisible();
  expect(submissions).toBe(1);
});

test("管理中心允许保存空密码的禁用 Doris 连接", async ({ page }) => {
  await page.goto("./");
  await page
    .getByLabel("账号", { exact: true })
    .fill(process.env.E2E_USERNAME || "admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.getByRole("button", { name: "管理中心", exact: false }).click();
  const firstRow = page.locator(".admin-page tbody tr[data-row-key]").first();
  const testBox = await firstRow
    .getByRole("button", { name: "测试连接", exact: false })
    .boundingBox();
  const editBox = await firstRow
    .getByRole("button", { name: "编辑", exact: false })
    .boundingBox();
  expect(Math.abs(testBox!.y - editBox!.y)).toBeLessThan(2);
  await page.screenshot({ path: "../.local/admin-layout.png", fullPage: true });
  await page.getByRole("button", { name: "新建连接", exact: false }).click();
  const dialog = page.getByRole("dialog");
  const name = "Doris 配置回归 " + Date.now();
  await dialog.getByLabel("连接名称", { exact: true }).fill(name);
  await dialog.locator(".ant-select").first().click();
  await page.getByText("Doris", { exact: true }).last().click();
  await dialog.getByRole("textbox", { name: /主机地址/ }).fill("127.0.0.1");
  await dialog.getByRole("textbox", { name: /数据库账号/ }).fill("root");
  await dialog.getByLabel("连接启用", { exact: true }).click();
  await dialog.getByRole("button", { name: "保存连接" }).click();
  await expect(dialog).not.toBeVisible();
  await page.locator(".ant-pagination-item:visible").last().click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
});

test("格式化全文、选区与撤销，历史操作保持同行", async ({ page }) => {
  await page.goto("./");
  await page
    .getByLabel("账号", { exact: true })
    .fill(process.env.E2E_USERNAME || "admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  const editor = page.locator(".monaco-editor textarea");
  await editor.focus();
  await page.keyboard.press("Meta+A");
  await page.keyboard.insertText("select 1;\nselect 2;");
  await page.getByRole("button", { name: "格式化 SQL", exact: true }).click();
  await expect(page.locator(".view-lines")).toContainText("SELECT");
  await page.keyboard.press("Meta+Z");
  await expect(page.locator(".view-lines")).toContainText("select 1;");
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < "select 1;".length; i++)
    await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "格式化 SQL", exact: true }).click();
  await expect(page.locator(".view-lines")).toContainText("SELECT");
  await expect(page.locator(".view-lines")).toContainText("select 2;");
  await page.getByText("执行历史", { exact: true }).click();
  const actions = page.locator(".history-actions").first();
  await expect(actions).toBeVisible();
  await expect(
    page.getByRole("button", { name: "详情", exact: true }),
  ).toHaveCount(0);
  await expect(
    actions.getByRole("button", { name: "打开", exact: false }),
  ).toBeVisible();
  const widths = await page
    .locator(".history-table .ant-table-thead")
    .first()
    .locator("th")
    .evaluateAll((cells) => cells.map((c) => c.getBoundingClientRect().width));
  expect(widths[0] / widths.reduce((a, b) => a + b, 0)).toBeCloseTo(0.5, 1);
  await page.screenshot({
    path: "../.local/history-layout.png",
    fullPage: true,
  });
});

test("个人 SQL：保存全文、打开、更新、另存为、改名与删除", async ({ page }) => {
  await page.goto("./");
  await page
    .getByLabel("账号", { exact: true })
    .fill(process.env.E2E_USERNAME || "admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  const editor = page.locator(".monaco-editor textarea");
  const name = `保存验收 ${Date.now()}`;
  const sql = "SELECT 101 AS first;\nSELECT 102 AS second;";
  await editor.focus();
  await page.keyboard.press("Meta+A");
  await page.keyboard.insertText(sql);
  for (let i = 0; i < "SELECT 102 AS second;".length; i++)
    await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "保存 SQL", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await page.route("**/api/saved-queries", async (route) => {
    if (route.request().method() === "POST")
      await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await dialog.getByLabel("名称", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await page.unroute("**/api/saved-queries");
  await page.getByRole("button", { name: "我的 SQL", exact: false }).click();
  await page.getByPlaceholder("搜索名称或 SQL").fill(name);
  await page.getByPlaceholder("搜索名称或 SQL").press("Enter");
  await expect(
    page.locator(".saved-query-table").getByText(name, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "我的 SQL", exact: false }).click();
  await page.getByPlaceholder("搜索名称或 SQL").fill(name);
  await page.getByPlaceholder("搜索名称或 SQL").press("Enter");
  let submissions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/sqlplat/api/executions")
    )
      submissions++;
  });
  await page
    .getByRole("button", { name: "打开", exact: false })
    .first()
    .click();
  await expect(page.locator(".view-lines")).toContainText("101");
  await expect(page.locator(".view-lines")).toContainText("102");
  await expect(page.locator(".result-table")).toHaveCount(0);
  expect(submissions).toBe(0);
  await editor.focus();
  await page.keyboard.press("Meta+A");
  await page.keyboard.insertText("SELECT 103 AS updated;");
  await page.getByRole("button", { name: "保存 SQL", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("名称", { exact: true })).toHaveValue(name);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "另存为", exact: true }).click();
  await dialog.getByLabel("名称", { exact: true }).fill(name + " 副本");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "我的 SQL", exact: false }).click();
  await page.getByPlaceholder("搜索名称或 SQL").fill(name);
  await page.getByPlaceholder("搜索名称或 SQL").press("Enter");
  await expect(
    page.locator(".saved-query-table tbody tr[data-row-key]"),
  ).toHaveCount(2);
  const original = page
    .locator(".saved-query-table tbody tr[data-row-key]")
    .filter({ has: page.getByText(name, { exact: true }) });
  await expect(original).toContainText("103");
  await original.getByRole("button", { name: "重命名", exact: true }).click();
  await dialog.getByLabel("名称", { exact: true }).fill(name + " 改名");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page
      .locator(".saved-query-table")
      .getByText(name + " 改名", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../.local/saved-queries.png",
    fullPage: true,
  });
  for (let i = 0; i < 2; i++) {
    await page
      .locator(".saved-query-table tbody tr[data-row-key]")
      .first()
      .getByRole("button", { name: "删除", exact: true })
      .click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(
      page.locator(".saved-query-table tbody tr[data-row-key]"),
    ).toHaveCount(1 - i);
  }
});

test("已删除保存项不会自动新建，另存为可恢复", async ({ page }) => {
  await page.goto("./");
  await page
    .getByLabel("账号", { exact: true })
    .fill(process.env.E2E_USERNAME || "admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  const name = `删除恢复验收 ${Date.now()}`;
  await page.getByRole("button", { name: "保存 SQL", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill(name);
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/sqlplat/api/saved-queries") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  const response = await created;
  const item = await response.json();
  const csrf = response.request().headers()["x-csrf-token"];
  await expect(dialog).not.toBeVisible();
  const removed = await page.request.delete(
    `/sqlplat/api/saved-queries/${item.id}`,
    {
      headers: { "X-CSRF-Token": csrf },
    },
  );
  expect(removed.status()).toBe(204);
  await page.getByRole("button", { name: "保存 SQL", exact: true }).click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByText("保存的 SQL 不存在，请使用另存为创建新记录", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "另存为", exact: true }).click();
  await dialog.getByLabel("名称", { exact: true }).fill(name + " 新建");
  const copied = page.waitForResponse(
    (response) =>
      response.url().endsWith("/sqlplat/api/saved-queries") &&
      response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  const copy = await (await copied).json();
  expect(copy.id).not.toBe(item.id);
  await expect(dialog).not.toBeVisible();
  expect(
    (
      await page.request.delete(`/sqlplat/api/saved-queries/${copy.id}`, {
        headers: { "X-CSRF-Token": csrf },
      })
    ).status(),
  ).toBe(204);
});
