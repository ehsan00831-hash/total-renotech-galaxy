import type { Metadata, Viewport } from "next";
import { profile } from "@/data/content";
import "./globals.css";

const SITE_URL = "https://yourdomain.com";
const description =
  "Cinematic creative portfolio of a 3D designer, photographer, video editor, AI creator and web developer. Galaxy-grade visual experiences.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${profile.name} — 3D · Photo · Video · AI · Web`,
    template: `%s — ${profile.name}`,
  },
  description,
  keywords: [
    "3D designer",
    "photographer",
    "video editor",
    "AI creator",
    "web developer",
    "creative portfolio",
    "motion design",
    "WebGL",
  ],
  authors: [{ name: profile.name }],
  creator: profile.name,
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: `${profile.name} — Creative Universe`,
    description,
    siteName: `${profile.name} Portfolio`,
  },
  twitter: {
    card: "summary_large_image",
    title: `${profile.name} — Creative Universe`,
    description,
  },
  robots: { index: true, follow: true },
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#03040a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Fonts loaded at runtime (non-blocking) so builds never depend on
            reaching Google Fonts. Graceful system fallbacks are defined in globals.css. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- root layout, applies site-wide; loaded at runtime to keep builds offline-safe */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;600;700;800;900&family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="cosmic-bg min-h-screen antialiased">{children}</body>
    </html>
  );
}
