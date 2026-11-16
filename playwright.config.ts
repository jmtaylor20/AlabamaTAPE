import { defineConfig } from "@playwright/test";

// End-to-end checks against a production build with the real security headers.
// A small stand-in for the Supabase Auth API (tests/e2e/mock-supabase.mjs) lets
// the suite walk the MFA page when the build was made against it; see
// tests/e2e/hydration.spec.ts. Everything else exercises the public surface.
const MOCK_PORT = 3101;
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100", viewport: { width: 1180, height: 820 } },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "node tests/e2e/mock-supabase.mjs",
          url: `${MOCK_URL}/__calls`,
          reuseExistingServer: true,
          timeout: 30_000,
          env: { E2E_MOCK_SUPABASE_PORT: String(MOCK_PORT) },
        },
        {
          command: "npx next start -p 3100",
          url: "http://127.0.0.1:3100/api/health",
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? MOCK_URL,
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_placeholder_for_ci_only",
          },
        },
      ],
  projects: [
    {
      name: "chromium",
      // PW_CHROMIUM_PATH lets a machine with a preinstalled Chromium run the suite without downloading a browser.
      use: { browserName: "chromium", launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {} },
    },
  ],
});
