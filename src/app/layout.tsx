import "@/styles/globals.css";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { ThemeProvider } from "next-themes";
import { UserMenu } from "@/components/UserMenu";
import { QuotaBanner } from "@/components/QuotaBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BetterOsfLogo } from "@/components/BetterOsfLogo";

export const metadata: Metadata = {
  title: "BetterOSF",
  description: "A better interface to the Open Science Framework.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The middleware sets a per-request CSP nonce; hand it to next-themes so its
  // inline anti-FOUC script carries the nonce (strict-dynamic blocks it otherwise).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://api.osf.io" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://files.osf.io" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://accounts.osf.io" />
      </head>
      <body className="min-h-screen flex flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-blue-600 focus:text-white focus:px-3 focus:py-1 focus:rounded"
        >
          Skip to content
        </a>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
          <header className="border-b border-neutral-200 dark:border-neutral-800 px-4 sm:px-6 py-3 flex flex-wrap justify-between items-center gap-2">
            <div className="flex items-center gap-4">
              <a href="/" className="font-semibold" aria-label="BetterOSF home">
                <BetterOsfLogo variant="compact" className="h-8" />
              </a>
              <a href="/search" className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">Search</a>
              <a href="/bookmarklet" className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">Bookmarklet</a>
              <a href="/about" className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">About</a>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <QuotaBanner />
          <main id="main-content" className="flex-1 px-4 sm:px-6 py-8">{children}</main>
          <footer className="border-t border-neutral-200 dark:border-neutral-800 px-4 sm:px-6 py-4 text-sm text-neutral-500 flex justify-between flex-wrap gap-2">
            <span className="flex items-center gap-2">
              <BetterOsfLogo variant="mark" className="h-7 w-9" />
              <span>
                BetterOSF is part of{" "}
                <a href="https://scirenity.com" className="hover:underline">Scirenity</a>; data lives on{" "}
                <a href="https://osf.io" className="hover:underline">OSF</a>.
              </span>
            </span>
            <span className="flex gap-4">
              <a href="/about" className="hover:underline">About</a>
              <a href="/bookmarklet" className="hover:underline">Bookmarklet</a>
              <a href="/privacy" className="hover:underline">Privacy</a>
              <a href="https://scirenity.com" className="hover:underline">Scirenity</a>
              <a href="https://github.com/giladfeldman/betterosf" className="hover:underline">GitHub</a>
            </span>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
