import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("管理员删除连接：确认、取消、单行布局和删除后不可用", async ({ page }) => {
  const password =
    process.env.E2E_PASSWORD ||
    readFileSync("../.local/admin-access.txt", "utf-8")
      .split("\n")
      .find((line) => line.startsWith("密码："))!
      .slice(3);
  await page.goto("./");
  await page
    .getByLabel("账号", { exact: true })
    .fill(process.env.E2E_USERNAME || "admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByText("查询工作台", { exact: false })).toBeVisible();
  const { csrf_token } = await (
    await page.request.get("/sqlplat/api/auth/me")
  ).json();
  const response = await page.request.post("/sqlplat/api/connections", {
    headers: { "X-CSRF-Token": csrf_token },
    data: {
      name: `删除测试-${Date.now()}`,
      kind: "mysql",
      host: "127.0.0.1",
      port: 3306,
      username: "test",
      password: "",
      enabled: false,
    },
  });
  expect(response.status()).toBe(201);
  const connection = await response.json();
  try {
    await page.getByRole("button", { name: /管理中心/ }).click();
    await expect(
      page.getByRole("row").filter({ hasText: "本地 MySQL" }),
    ).toBeVisible();
    await page.locator(".ant-pagination-item:visible").last().click();
    const row = page.getByRole("row").filter({ hasText: connection.name });
    await expect(row).toBeVisible();
    const buttons = row.locator(".connection-actions button");
    const boxes = await Promise.all(
      [0, 1, 2].map((index) => buttons.nth(index).boundingBox()),
    );
    expect(boxes.every((box) => box && Math.abs(box.y - boxes[0]!.y) < 2)).toBe(
      true,
    );
    await page.screenshot({
      path: "../.local/connection-delete-layout.png",
      fullPage: true,
    });
    await row.getByRole("button", { name: "删除", exact: true }).click();
    const modal = page.getByRole("dialog");
    await expect(modal).toContainText(connection.name);
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await modal.getByRole("button", { name: "删除连接", exact: true }).click();
    await expect(modal).not.toBeVisible();
    await expect(row).toHaveCount(0);
    const listing = await (
      await page.request.get("/sqlplat/api/connections")
    ).json();
    expect(
      listing.some((item: { id: number }) => item.id === connection.id),
    ).toBe(false);
  } finally {
    await page.request.delete(`/sqlplat/api/connections/${connection.id}`, {
      headers: { "X-CSRF-Token": csrf_token },
    });
  }
});
