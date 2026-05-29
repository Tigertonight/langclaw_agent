import { test, expect } from "@playwright/test";

test("if lucide CDN is blocked, paperclip is invisible", async ({ page }) => {
  // simulate offline / CDN blocked
  await page.route("**/unpkg.com/**", (route) => route.abort());
  await page.route("**/cdn.jsdelivr.net/**", (route) => route.abort());

  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const btn = page.locator("#attachBtn");
  await expect(btn).toBeVisible();
  const svgCount = await btn.locator("svg").count();
  const innerHTML = await btn.innerHTML();
  console.log("[btn innerHTML]", innerHTML);
  console.log("[svg count]", svgCount);
  console.log("[errors]", errors);

  await page.screenshot({ path: "test-results/screenshots/blocked-lucide.png" });
});
