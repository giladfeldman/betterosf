import "@/styles/globals.css";
import type { Metadata } from "next";
import { UserMenu } from "@/components/UserMenu";

export const metadata: Metadata = {
  title: "BetterOSF",
  description: "A better interface to the Open Science Framework.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <header className="border-b border-neutral-200 dark:border-neutral-800 px-6 py-3 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <a href="/" className="font-semibold">BetterOSF</a>
            <a href="/search" className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100">Search</a>
          </div>
          <UserMenu />
        </header>
        <main className="px-6 py-8">{children}</main>
        <footer className="border-t border-neutral-200 dark:border-neutral-800 px-6 py-4 text-sm text-neutral-500">
          BetterOSF is an unofficial alternative interface to the Open Science Framework. Data lives on OSF.
        </footer>
      </body>
    </html>
  );
}
