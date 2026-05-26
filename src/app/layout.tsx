import "@/styles/globals.css";
import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { UserMenu } from "@/components/UserMenu";
import { QuotaBanner } from "@/components/QuotaBanner";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "BetterOSF",
  description: "A better interface to the Open Science Framework.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <header className="border-b border-neutral-200 dark:border-neutral-800 px-4 sm:px-6 py-3 flex flex-wrap justify-between items-center gap-2">
            <div className="flex items-center gap-4">
              <a href="/" className="font-semibold">BetterOSF</a>
              <a href="/search" className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">Search</a>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <QuotaBanner />
          <main id="main-content" className="flex-1 px-4 sm:px-6 py-8">{children}</main>
          <footer className="border-t border-neutral-200 dark:border-neutral-800 px-4 sm:px-6 py-4 text-sm text-neutral-500 flex justify-between flex-wrap gap-2">
            <span>
              BetterOSF is an unofficial alternative interface to the{" "}
              <a href="https://osf.io" className="hover:underline">Open Science Framework</a>. Data lives on OSF.
            </span>
            <span className="flex gap-4">
              <a href="/about" className="hover:underline">About</a>
              <a href="/privacy" className="hover:underline">Privacy</a>
              <a href="https://github.com/giladfeldman/betterosf" className="hover:underline">GitHub</a>
            </span>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
