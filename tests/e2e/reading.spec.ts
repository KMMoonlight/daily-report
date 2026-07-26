import { expect, test } from "@playwright/test";

test("reader can open the latest daily report", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Tech Daily & Weekly/);
  await expect(page.getByRole("heading", { name: "今天，科技世界改变了什么？" })).toBeVisible();
  await expect(page.getByRole("link", { name: /阅读最新日报/ })).toBeVisible();
});

test("reader can filter and search the archive", async ({ page }) => {
  await page.goto("/archive");

  await page.getByLabel("栏目").selectOption("research");
  await expect(page.locator("[data-report-card]:visible")).toHaveCount(1);

  await page.getByLabel("搜索").fill("开放模型");
  await expect(page.getByText("开放模型进入可本地评估阶段")).toBeVisible();
});

test("an immutable historical item exposes its later correction", async ({ page }) => {
  await page.goto("/daily/2026-07-25");

  const item = page.locator("#open-model-local-evaluation").locator("..");
  await expect(item.getByText("此条目有后续更正")).toBeVisible();
  await expect(item.getByRole("link", { name: "查看更正" })).toHaveAttribute("href", /2026-07-26/);
});
