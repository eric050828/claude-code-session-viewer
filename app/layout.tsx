import type { Metadata, Viewport } from "next";
import "./globals.css";
import { themeInitScript } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Claude Code Session Viewer",
  description: "Local viewer for Claude Code session logs",
};

// Theme-color matches the CSS background tokens (light: white-ish, dark: zinc-950).
// Two entries with media queries let the browser pick the right one without JS.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inline before render to avoid FOUC. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
