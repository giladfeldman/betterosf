import * as React from "react";

/** Standalone email HTML document — not a Next.js page; `<head>` is intentional. */
/* eslint-disable @next/next/no-head-element */
export function EmailLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
      </head>
      <body style={{ fontFamily: "sans-serif", margin: 0, padding: 0, background: "#f6f6f6" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", padding: 24, background: "#ffffff" }}>
          {children}
          <p style={{ color: "#666", fontSize: 12, marginTop: 32 }}>BetterOSF</p>
        </div>
      </body>
    </html>
  );
}
