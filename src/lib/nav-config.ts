/**
 * THE single definition of the header's destinations.
 *
 * Both halves of the breakpoint split read from here — the inline
 * `hidden md:flex` strip in `app/layout.tsx` and the `md:hidden`
 * `MobileNavMenu` — so a new entry cannot land in one breakpoint and miss the
 * other. That divergence, not the CSS, is the structural defect behind the
 * repeated mobile-nav regressions (mobile-ux rule M7).
 */
import type { Route } from "next";

// next.config enables typed routes, so href has to be a Route, not a string.
export interface NavItem {
  href: Route;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/search", label: "Search" },
  { href: "/bookmarklet", label: "Bookmarklet" },
  { href: "/about", label: "About" },
];
