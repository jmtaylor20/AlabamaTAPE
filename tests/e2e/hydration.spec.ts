import { expect, test, type Page } from "@playwright/test";

/**
 * Proves client components come alive under the production security headers.
 * The content security policy allows only nonced scripts; if the nonce is
 * missing from the markup Next.js emits, nothing hydrates, server-action
 * forms still post as plain forms, and the MFA page never leaves "Loading".
 * These checks fail in exactly that case.
 */

const MOCK_URL = process.env.E2E_MOCK_SUPABASE_URL ?? "http://127.0.0.1:3101";
// The browser bundle bakes the Supabase URL in at build time, so the MFA walk
// only works on a build made with the mock address. CI builds that way.
const builtAgainstMock = process.env.NEXT_PUBLIC_SUPABASE_URL === MOCK_URL && !process.env.E2E_BASE_URL;

// Netlify adds a collaboration script to deploy previews. It carries no nonce,
// the policy blocks it, and that is the intended outcome; it is not ours.
const NETLIFY_INJECTED = "/.netlify/scripts/";

declare global {
  interface Window {
    __cspViolations: string[];
    __next_f?: unknown[];
  }
}

async function recordCspViolations(page: Page) {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      if (e.blockedURI.includes("/.netlify/scripts/")) return;
      window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`);
    });
  });
}

function hydrated(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$")));
}

test("the policy carries a fresh nonce per response and never unsafe-inline for scripts", async ({ request }) => {
  const a = await request.get("/sign-in");
  const b = await request.get("/sign-in");
  const nonce = (res: typeof a) => /script-src 'nonce-([A-Za-z0-9+/=_-]+)'/.exec(res.headers()["content-security-policy"] ?? "")?.[1];
  const na = nonce(a);
  const nb = nonce(b);
  expect(na).toBeTruthy();
  expect(nb).toBeTruthy();
  expect(na).not.toBe(nb);
  const csp = a.headers()["content-security-policy"]!;
  const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"))!;
  expect(scriptSrc).toContain("'strict-dynamic'");
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).not.toContain("'unsafe-eval'");

  // Every script tag in the markup carries that response's nonce.
  const html = await a.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  const unnonced = scripts.filter((tag) => !tag.includes(`nonce="${na}"`) && !tag.includes(NETLIFY_INJECTED));
  expect(unnonced).toEqual([]);
});

test("the sign-in form hydrates with no policy violations", async ({ page }) => {
  await recordCspViolations(page);
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Email me a sign-in code" })).toBeVisible();
  // The RSC payload is delivered by inline scripts; blocked scripts leave it undefined.
  expect(await page.evaluate(() => Array.isArray(window.__next_f))).toBe(true);
  expect(await hydrated(page, "form")).toBe(true);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test("the public home page runs its scripts with no policy violations", async ({ page }) => {
  await recordCspViolations(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  expect(await page.evaluate(() => Array.isArray(window.__next_f))).toBe(true);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

test.describe("with a mocked identity provider", () => {
  test.skip(!builtAgainstMock, "needs a build made with NEXT_PUBLIC_SUPABASE_URL pointing at tests/e2e/mock-supabase.mjs");

  test.beforeEach(async ({ context, request }) => {
    await request.delete(`${MOCK_URL}/__calls`);
    // A fabricated session at assurance level 1: signed in, authenticator not yet enrolled.
    const now = Math.floor(Date.now() / 1000);
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
      sub: "00000000-0000-4000-8000-00000000e2e1",
      email: "reviewer.one@example.test",
      aud: "authenticated",
      role: "authenticated",
      aal: "aal1",
      amr: [{ method: "otp", timestamp: now }],
      session_id: "00000000-0000-4000-8000-00000000se55",
      iat: now,
      exp: now + 3600,
    })}.e2e-not-a-signature`;
    const session = { access_token: jwt, refresh_token: "e2e-refresh", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user: { id: "00000000-0000-4000-8000-00000000e2e1", email: "reviewer.one@example.test", aud: "authenticated", role: "authenticated" } };
    const ref = new URL(MOCK_URL).hostname.split(".")[0];
    await context.addCookies([{ name: `sb-${ref}-auth-token`, value: `base64-${b64(session)}`, domain: "127.0.0.1", path: "/" }]);
  });

  test("the MFA page reaches the enroll stage", async ({ page }) => {
    await recordCspViolations(page);
    await page.goto("/mfa");
    await expect(page.getByRole("heading", { name: "Verify it's you" })).toBeVisible();
    await expect(page.getByText("Set up your authenticator app")).toBeVisible();
    const qr = page.getByRole("img", { name: "QR code for your authenticator app" });
    await expect(qr).toBeVisible();
    expect(await qr.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    await expect(page.getByText("FABRICATEDSECRET234567")).toBeVisible();
    await expect(page.getByRole("button", { name: "Finish setup" })).toBeVisible();
    expect(await hydrated(page, "form")).toBe(true);
    expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  });

  test("an emailed link lands on a button and the token is used only when pressed", async ({ page, context, request }) => {
    await context.clearCookies();
    await page.goto("/auth/link?token_hash=fabricated-token-hash-0001&type=email");
    await expect(page.getByRole("heading", { name: "Finish signing in" })).toBeVisible();
    const calls = (await (await request.get(`${MOCK_URL}/__calls`)).json()) as string[];
    expect(calls.filter((c) => c.includes("/auth/v1/verify"))).toEqual([]);
    await page.getByRole("button", { name: "Continue to TAPE Online" }).click();
    await expect(page).toHaveURL(/\/sign-in\?error=link/);
    const after = (await (await request.get(`${MOCK_URL}/__calls`)).json()) as string[];
    expect(after.filter((c) => c.includes("/auth/v1/verify"))).toHaveLength(1);
  });

  test("a callback carrying a token sends it to the button page without using it", async ({ page, context, request }) => {
    await context.clearCookies();
    await page.goto("/auth/callback?token_hash=fabricated-token-hash-0002&type=email");
    await expect(page).toHaveURL(/\/auth\/link\?token_hash=fabricated-token-hash-0002&type=email$/);
    const calls = (await (await request.get(`${MOCK_URL}/__calls`)).json()) as string[];
    expect(calls.filter((c) => c.includes("/auth/v1/verify"))).toEqual([]);
  });
});
