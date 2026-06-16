import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Start with report-only to observe CSP violations before enforcing.
          {
            key: "Content-Security-Policy-Report-Only",
            value: "default-src 'self' https: data: blob:; base-uri 'self'; frame-ancestors 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};

export default config;
