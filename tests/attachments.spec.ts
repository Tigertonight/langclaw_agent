import { test, expect } from "@playwright/test";
import path from "node:path";

const FIXTURE = "/tmp/test-leads.csv";

test.describe("attachment upload UI", () => {
  test("page loads without JS errors and key elements exist", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Diagnostics first — print before assertions so we see them on failure
    console.log("[console errors]", consoleErrors);
    console.log("[page errors]", pageErrors);

    expect(pageErrors, `pageerror: ${pageErrors.join(" | ")}`).toEqual([]);

    // attachBtn exists, lucide rendered the SVG inside it
    const attachBtn = page.locator("#attachBtn");
    await expect(attachBtn).toBeVisible();
    const svgInBtn = await attachBtn.locator("svg").count();
    expect(svgInBtn, "lucide should render svg inside attachBtn").toBeGreaterThan(0);

    const fileInput = page.locator("#attachInput");
    await expect(fileInput).toHaveCount(1);
  });

  test("clicking paperclip opens file chooser and uploads", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The intercepts the native input click; use waitForEvent to capture it
    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 5000 });
    await page.locator("#attachBtn").click();
    let chooser;
    try {
      chooser = await fileChooserPromise;
    } catch (e) {
      console.log("[click failed] console:", consoleErrors);
      throw new Error("clicking #attachBtn did not open filechooser: " + (e as Error).message);
    }
    await chooser.setFiles(FIXTURE);

    // chip should appear with name leads.csv (or test-leads.csv) and ready/uploading status
    const chip = page.locator(".attach-chip").first();
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toHaveAttribute("data-kind", /excel|/, { timeout: 5_000 });

    // wait for ready state (no longer .uploading)
    await expect(chip).not.toHaveClass(/uploading/, { timeout: 15_000 });
    await expect(chip).not.toHaveClass(/failed/);

    // chip name shows the file
    const chipName = await chip.locator(".chip-name").textContent();
    expect(chipName).toContain("test-leads.csv");

    // lucide icon rendered inside chip-icon
    const chipSvg = await chip.locator(".chip-icon svg").count();
    expect(chipSvg, "lucide icon should render inside chip-icon").toBeGreaterThan(0);

    if (consoleErrors.length) {
      console.log("[non-fatal console errors]", consoleErrors);
    }
  });

  test("HTTP upload endpoint reachable via fetch from page context", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const fs = await import("node:fs");
    const buf = fs.readFileSync(FIXTURE);
    const b64 = buf.toString("base64");

    const result = await page.evaluate(async ({ b64, name }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], name, { type: "text/csv" });
      const fd = new FormData();
      fd.append("files", file);
      fd.append("user_id", "sales_001");
      fd.append("session_id", "playwright_smoke_" + Date.now());
      const res = await fetch("/api/attachments", { method: "POST", body: fd });
      const text = await res.text();
      return { status: res.status, body: text.slice(0, 500) };
    }, { b64, name: "test-leads.csv" });

    console.log("[upload result]", result);
    expect(result.status, "upload should return 2xx; body=" + result.body).toBeLessThan(300);
  });
});
