import { expect, test } from "@playwright/test";
import { ADMIN_ID, DIRECTOR_ID, MOCK_URL, signInAs } from "./session";

/**
 * The signed-in shell for two roles, rendered from a production build against
 * the mock identity provider with fabricated data. Checks that each role gets
 * its own navigation groups and a home page that says what needs them.
 */
const builtAgainstMock = process.env.NEXT_PUBLIC_SUPABASE_URL === MOCK_URL && !process.env.E2E_BASE_URL;
test.skip(!builtAgainstMock, "needs a build made with NEXT_PUBLIC_SUPABASE_URL pointing at tests/e2e/mock-supabase.mjs");

test("a State Admin sees grouped navigation and what needs them", async ({ page, context }) => {
  await signInAs(context, { sub: ADMIN_ID, email: "reviewer.one@example.test", aal: "aal2" });
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Good day, Avery/);
  const nav = page.getByRole("navigation", { name: "Primary" }).first();
  for (const group of ["Work", "Setup", "Administration"]) await expect(nav.getByText(group, { exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Systems" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Program catalog" })).toBeVisible();
  // The needs-you list is built from drafts, notifications, and overdue plans.
  await expect(page.getByText("1 message draft needs approval")).toBeVisible();
  await expect(page.getByText("Release Pine Ridge City")).toBeVisible();
  await expect(page.getByText("Improvement plan past due at Lakeview City")).toBeVisible();
  await expect(page.getByText("Finalize Construction Technology at Lakeview City")).toBeVisible();
});

test("a CTE Director sees one card for their system", async ({ page, context }) => {
  await signInAs(context, { sub: DIRECTOR_ID, email: "director.example@example.test", aal: "aal2" });
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Riverbend County");
  const nav = page.getByRole("navigation", { name: "Primary" }).first();
  await expect(nav.getByText("My system", { exact: true })).toBeVisible();
  await expect(nav.getByText("Setup", { exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Declarations" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Evidence and self-scores are due/ })).toBeVisible();
  await expect(page.getByText("2 of 2 selected programs have not been submitted", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open programs" })).toBeVisible();
  await expect(page.getByText("Welding").first()).toBeVisible();
});
