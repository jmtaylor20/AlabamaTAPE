import { expect, test } from "@playwright/test";

/**
 * Runs only when pointed at a real Supabase project (LIVE_TRIGGER=1). Proves the
 * invitation gate end to end: an address with no invitation is refused by the
 * database trigger during sign-in, and no account is created.
 */
test.skip(!process.env.LIVE_TRIGGER, "set LIVE_TRIGGER=1 to run against a real project");

test("an uninvited address cannot sign in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(`nobody.${Date.now()}@not-invited.example.org`);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByRole("alert")).toContainText("has not been invited");
});
