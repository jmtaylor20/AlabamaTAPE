import { defineConfig } from "@playwright/test";

// End-to-end checks of the public surface: sign-in page, redirects, headers.
// Authenticated flows need a real identity provider and are exercised manually.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100", viewport: { width: 1180, height: 820 } },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx next start -p 3100",
        url: "http://127.0.0.1:3100/api/health",
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_placeholder_for_ci_only",
        },
      },
  projects: [
    {
      name: "chromium",
      // PW_CHROMIUM_PATH lets a machine with a preinstalled Chromium run the suite without downloading a browser.
      use: { browserName: "chromium", launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {} },
    },
  ],
});
