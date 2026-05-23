import "@/styles/globals.css";
import type { Metadata } from "next";
import { UserMenu } from "@/components/UserMenu";
import { QuotaBanner } from "@/components/QuotaBanner";

export const metadata: Metadata = {
  title: "BetterOSF",
  description: "A better interface to the Open Science Framework.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <header className="border-b border-neutral-200 dark:border-neutral-800 px-4 sm:px-6 py-3 flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center gap-4">
            <a href="/" className="font-semibold">BetterOSF</a>
            <a href="/search" className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">Search</a>
          </div>
          <UserMenu />
        </header>
        <QuotaBanner />
        <main className="px-4 sm:px-6 py-8">{children}</main>
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
      </body>
    </html>
  );
}
