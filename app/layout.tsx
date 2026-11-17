import type { Metadata } from "next";
import "./globals.css";

// Every response carries a one-time script nonce, so no page may be prerendered.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "TAPE Online", template: "%s | TAPE Online" },
  description: "Alabama CTE program review.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-4 focus:py-2 focus:text-brand"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
