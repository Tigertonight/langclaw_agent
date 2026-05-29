import { test, expect } from "@playwright/test";

const FIXTURE = "/tmp/test-leads.csv";
const SHOT_DIR = "test-results/screenshots";

test.use({ viewport: { width: 1440, height: 900 } });

test("capture UI: empty composer, after upload, drag overlay", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // Wait for lucide to inject SVGs
  await page.waitForFunction(() => !!document.querySelector("#attachBtn svg"), { timeout: 5000 });

  // [1] empty state
  await page.screenshot({ path: `${SHOT_DIR}/01-empty.png`, fullPage: false });

  // [2] focus composer to make composer-shell highlight visible
  await page.locator("#input").click();
  await page.screenshot({ path: `${SHOT_DIR}/02-focused.png`, fullPage: false });

  // [3] upload via paperclip
  const fc = page.waitForEvent("filechooser");
  await page.locator("#attachBtn").click();
  (await fc).setFiles(FIXTURE);

  // wait for chip to settle (no longer uploading, no failed)
  const chip = page.locator(".attach-chip").first();
  await expect(chip).toBeVisible({ timeout: 10_000 });
  await expect(chip).not.toHaveClass(/uploading/, { timeout: 15_000 });
  await expect(chip).not.toHaveClass(/failed/);
  await page.screenshot({ path: `${SHOT_DIR}/03-after-upload.png`, fullPage: false });

  // [4] simulate drag overlay (we can just toggle the CSS class to show it visually)
  await page.evaluate(() => {
    const o = document.getElementById("dropOverlay");
    if (o) o.classList.add("active");
  });
  // give lucide a beat to render the cloud icon
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOT_DIR}/04-drag-overlay.png`, fullPage: false });

  // restore
  await page.evaluate(() => document.getElementById("dropOverlay")?.classList.remove("active"));

  // [5] zoom into composer area
  const composer = page.locator(".composer-shell");
  await composer.screenshot({ path: `${SHOT_DIR}/05-composer-zoom.png` });

  console.log("[errors]", errors);
  expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
});
