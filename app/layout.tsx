import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "TAPE Resource Hub | Alabama CTE",
    description: "Prepare, organize, improve—before official evidence moves into Cognia.",
    icons: { icon: "/favicon.svg" },
    openGraph: { title: "TAPE Resource Hub | Alabama CTE", description: "Build programs that last.", images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: "TAPE Resource Hub | Alabama CTE", description: "Build programs that last.", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
