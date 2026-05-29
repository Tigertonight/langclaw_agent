import { test, expect } from "@playwright/test";

test.describe("landing page", () => {
  test.beforeEach(async ({ page }) => {
    // 清掉 localStorage 里的旧 session（welcome 消息会被识别成空，但保险起见清干净）
    await page.addInitScript(() => {
      try { localStorage.clear(); } catch {}
    });
  });

  test("desktop: enters landing view by default with hero + 4 cards", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("body")).toHaveAttribute("data-view", "landing");
    await expect(page.locator("#landingHero")).toBeVisible();
    await expect(page.locator("#landingTitle")).not.toHaveText("");
    await expect(page.locator("#messages")).toBeHidden();

    const cards = page.locator("#landingCards .landing-card");
    await expect(cards).toHaveCount(4);
    await expect(cards.first()).toBeVisible();

    // 推荐 chips 在 landing 视图被隐藏（hero 卡片代替）
    await expect(page.locator("#composerRec")).toBeHidden();

    // composer 仍然可见
    await expect(page.locator(".composer-shell")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("clicking landing card inserts tag into composer and stays in landing", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const card = page.locator("#landingCards .landing-card").first();
    const cardLabel = ((await card.locator(".card-label").textContent()) || "").trim();
    await card.click();

    const tag = page.locator("#input .cmd-tag");
    await expect(tag).toBeVisible();
    await expect(tag).toHaveText(cardLabel);

    // 还没发消息，仍是 landing
    await expect(page.locator("body")).toHaveAttribute("data-view", "landing");
  });

  test("after sending first message, switches to chat view", async ({ page }) => {
    await page.route("**/api/chat/stream", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: 'event: done\ndata: {"type":"done","answer":"ok"}\n\n'
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("body")).toHaveAttribute("data-view", "landing");
    await page.locator("#input").click();
    await page.keyboard.type("看一下今天情况");
    await page.locator("#send").click();

    await expect(page.locator("body")).toHaveAttribute("data-view", "chat");
    await expect(page.locator("#landingHero")).toBeHidden();
    await expect(page.locator("#messages")).toBeVisible();
    await expect(page.locator("#messages .msg.user")).toHaveCount(1);
    // chips 在 chat 视图回来
    await expect(page.locator("#composerRec")).toBeVisible();
  });

  test("clicking 新会话 returns to landing view", async ({ page }) => {
    await page.route("**/api/chat/stream", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: 'event: done\ndata: {"type":"done","answer":"ok"}\n\n'
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("#input").click();
    await page.keyboard.type("hello");
    await page.locator("#send").click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "chat");

    await page.locator("#newChat").click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "landing");
    await expect(page.locator("#landingHero")).toBeVisible();
    await expect(page.locator("#messages .msg")).toHaveCount(0);
  });

  test("mobile: cards collapse to 2x2 grid", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("body")).toHaveAttribute("data-view", "landing");
    const cards = page.locator("#landingCards .landing-card");
    await expect(cards).toHaveCount(4);

    const grid = page.locator("#landingCards");
    const cols = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    // 应该是 2 列（含 2 个数值 token）
    expect(cols.split(/\s+/).filter((token) => token.trim().length > 0).length).toBe(2);
  });

  test("screenshots: landing desktop + mobile", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "test-results/screenshots/landing-desktop.png", fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "test-results/screenshots/landing-mobile.png", fullPage: false });
  });
});
