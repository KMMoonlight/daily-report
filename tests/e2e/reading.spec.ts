import { expect, test } from "@playwright/test";

test("reader can open the latest daily report", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Tech Daily & Weekly/);
  await expect(page.getByRole("heading", { name: "今天，科技世界改变了什么？" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "最近日报" })).toBeVisible();
  await expect(page.getByRole("link", { name: /最新日报/ })).toBeVisible();
  await expect(page.getByText("从中英文一手来源")).toHaveCount(0);
  await expect(page.getByText("不是新闻瀑布")).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toHaveCount(0);
});

test("reader can filter and search the archive", async ({ page }) => {
  await page.goto("/archive");

  await page.getByLabel("栏目").selectOption("research");
  await expect(page.locator("[data-report-card]:visible")).toHaveCount(1);

  await page.getByLabel("搜索").fill("开放模型");
  await expect(page.getByText("开放模型进入可本地评估阶段")).toBeVisible();
});

test("archive reveals more matching entries on demand", async ({ page }) => {
  await page.goto("/archive");

  await page.locator("[data-archive-list]").evaluate((node) => {
    (node as HTMLElement).dataset.pageSize = "1";
  });
  await page.getByLabel("栏目").selectOption("products");
  await page.getByLabel("栏目").selectOption("");

  await expect(page.locator("[data-report-card]:visible")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "加载更多" })).toBeVisible();

  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(page.locator("[data-report-card]:visible")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "加载更多" })).toBeHidden();
});

test("correction section is not shown to readers", async ({ page }) => {
  await page.goto("/daily/2026-07-26");

  await expect(page.getByRole("heading", { name: "更正" })).toHaveCount(0);
  await expect(page.getByText("此条目有后续更正")).toHaveCount(0);
  await expect(page.getByText("更正：开放模型许可证并未覆盖全部商业场景")).toHaveCount(0);
});

test("daily content is grouped by section and product screenshots are optional", async ({ page }) => {
  await page.goto("/daily/2026-07-25");

  const headings = await page.locator("[data-section-group] > header h2").allTextContents();
  expect(headings).toEqual(["新品与工具", "研究与开源"]);
  await expect(page.locator('img[alt="终端编码智能体界面截图"]')).toHaveAttribute(
    "src",
    "https://example.com/terminal-agent-screenshot.png",
  );
  await expect(
    page.getByRole("heading", { name: "面向终端工作流的新型编码智能体" }).getByRole("link"),
  ).toHaveAttribute("href", "https://example.com/terminal-agent");
  await expect(page.getByText("仅基于公开摘要，未读取全文。")).toHaveCount(0);
  await expect(page.getByText(/本报告由 Tech Daily & Weekly/)).toHaveCount(0);
  await expect(page.locator(".section-heading p, .section-count, .report-item time")).toHaveCount(0);
  await expect(page.getByText("补充来源")).toHaveCount(0);
  await expect(page.locator(".analysis")).toHaveCount(0);
  await expect(page.locator(".topic-list")).toHaveCount(0);
});
