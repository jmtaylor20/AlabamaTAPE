import { expect, test } from "@playwright/test";

test("health route answers without revealing configuration", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, service: "tape-online" });
});

test("every response carries the security headers", async ({ request }) => {
  const res = await request.get("/sign-in");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("the app and admin pages redirect visitors who are not signed in", async ({ page }) => {
  for (const path of ["/app", "/app/admin/users", "/app/admin/audit", "/app/lea", "/mfa"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in$/);
  }
});

test("the sign-in page offers provider and email sign-in and validates the address", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "TAPE Online" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Microsoft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  const email = page.getByLabel("Email address");
  await expect(email).toBeVisible();
  // The browser's own validation blocks a malformed address before the server is asked.
  await email.fill("not-an-email");
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  const invalid = await email.evaluate((el: HTMLInputElement) => !el.validity.valid);
  expect(invalid).toBe(true);
});

test("the sign-in page is keyboard reachable and the skip link exists", async ({ page }) => {
  await page.goto("/sign-in");
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
  expect(first).toBe("Skip to main content");
});
