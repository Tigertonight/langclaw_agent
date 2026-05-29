import { test, expect, Page } from "@playwright/test";

// chips 仅在 chat 视图（已有消息）时可见。所有用例先把视图强切到 chat。
async function enterChatView(page: Page) {
  await page.evaluate(() => { document.body.dataset.view = "chat"; });
}

test.describe("composer recommended chips (A2)", () => {
  test("chips render outside the composer-shell, first one is primary, no JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await enterChatView(page);

    const rec = page.locator("#composerRec");
    await expect(rec).toBeVisible();
    expect(await page.locator(".composer-shell #composerRec").count()).toBe(0);

    const chips = page.locator("#cmdChips .cmd-chip");
    await expect(chips.first()).toBeVisible({ timeout: 5000 });
    await expect(chips.first()).toHaveClass(/primary/);

    expect(errors).toEqual([]);
  });

  test("clicking chip inserts tag (not plain text) into contenteditable input", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await enterChatView(page);

    const chip = page.locator("#cmdChips .cmd-chip").first();
    const chipLabel = ((await chip.textContent()) || "").trim();
    await chip.click();

    // 输入框里不应该有 "/今日新线索" 这样的纯文本，而应该是一个 .cmd-tag 元素
    const tag = page.locator("#input .cmd-tag");
    await expect(tag).toBeVisible();
    await expect(tag).toHaveText(chipLabel);
    const cmdAttr = await tag.getAttribute("data-cmd");
    expect(cmdAttr).toMatch(/^\//);

    // input 仍可输入纯文本，焦点应在 input 上
    await page.keyboard.type("帮我看下");
    const inputText = (await page.locator("#input").innerText()).replace(/ /g, " ");
    expect(inputText).toContain(chipLabel);
    expect(inputText).toContain("帮我看下");
  });

  test("only one tag is allowed; clicking another chip replaces it", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await enterChatView(page);

    const chips = page.locator("#cmdChips .cmd-chip");
    const count = await chips.count();
    if (count < 2) test.skip();

    await chips.nth(0).click();
    await chips.nth(1).click();

    const tags = page.locator("#input .cmd-tag");
    await expect(tags).toHaveCount(1);
    const secondLabel = ((await chips.nth(1).textContent()) || "").trim();
    await expect(tags).toHaveText(secondLabel);
  });

  test("submit serializes tag back into command + text", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await enterChatView(page);

    let captured: any = null;
    await page.route("**/api/chat/stream", async (route) => {
      try { captured = JSON.parse(route.request().postData() || "{}"); } catch {}
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body: 'event: done\ndata: {"type":"done","answer":"ok"}\n\n'
      });
    });

    const chip = page.locator("#cmdChips .cmd-chip").first();
    await chip.click();
    await page.keyboard.type("帮我看下");
    await page.locator("#send").click();
    await page.waitForTimeout(800);

    expect(captured).toBeTruthy();
    expect(captured.message).toMatch(/^\/[^\s]+/);
    expect(captured.message).toContain("帮我看下");
  });

  test("collapse toggle appears when chips overflow", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await enterChatView(page);

    await page.evaluate(() => {
      const list = document.getElementById("cmdChips");
      if (!list) return;
      list.innerHTML = list.innerHTML + list.innerHTML + list.innerHTML;
    });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForTimeout(150);

    const toggle = page.locator("#recToggle");
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect(page.locator("#cmdChips")).toHaveClass(/expanded/);
  });

  test("placeholder shows when input is fully empty", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await enterChatView(page);

    const input = page.locator("#input");
    const placeholder = await input.getAttribute("data-placeholder");
    expect(placeholder).toBeTruthy();
    // CSS :empty::before — verify input is :empty
    const isEmpty = await input.evaluate((el) => el.matches(":empty"));
    expect(isEmpty).toBe(true);

    // After clicking a chip, no longer :empty
    await page.locator("#cmdChips .cmd-chip").first().click();
    const stillEmpty = await input.evaluate((el) => el.matches(":empty"));
    expect(stillEmpty).toBe(false);
  });

  test("screenshot tag in input", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await enterChatView(page);
    await page.waitForFunction(() => !!document.querySelector("#cmdChips .cmd-chip"));

    await page.locator(".composer").screenshot({ path: "test-results/screenshots/rec-empty.png" });

    await page.locator("#cmdChips .cmd-chip").first().click();
    await page.keyboard.type("帮我看下今天的情况");
    await page.locator(".composer").screenshot({ path: "test-results/screenshots/rec-with-tag.png" });
  });
});
