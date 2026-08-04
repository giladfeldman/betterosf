/**
 * Pins the workspace's relative-time copy. The important case is the LAST one:
 * entries saved before visit tracking existed have no timestamp, and a naive
 * implementation would render the Unix epoch as "56y ago" — confidently wrong
 * information is worse than an honest "unknown".
 */
import { describe, it, expect } from "vitest";
import { formatRelativeTime, formatAbsoluteTime } from "@/lib/relative-time";

const NOW = Date.parse("2026-08-04T12:00:00Z");
const rel = (iso: string) => formatRelativeTime(Date.parse(iso), NOW);

describe("formatRelativeTime", () => {
  it("renders sub-minute gaps as 'just now'", () => {
    expect(rel("2026-08-04T11:59:30Z")).toBe("just now");
  });

  it("renders minutes, hours and days", () => {
    expect(rel("2026-08-04T11:45:00Z")).toBe("15m ago");
    expect(rel("2026-08-04T09:00:00Z")).toBe("3h ago");
    expect(rel("2026-07-30T12:00:00Z")).toBe("5d ago");
  });

  it("uses 'yesterday' for exactly one day", () => {
    expect(rel("2026-08-03T12:00:00Z")).toBe("yesterday");
  });

  it("rolls up to months and years", () => {
    expect(rel("2026-05-04T12:00:00Z")).toBe("3mo ago");
    expect(rel("2024-08-04T12:00:00Z")).toBe("2y ago");
  });

  it("returns null for missing timestamps rather than inventing one", () => {
    expect(formatRelativeTime(undefined, NOW)).toBeNull();
    expect(formatRelativeTime(Number.NaN, NOW)).toBeNull();
  });

  it("does NOT render a legacy/epoch entry as a huge age", () => {
    // The regression this guards: `lastViewed` absent -> 0 -> "56y ago".
    const legacy = undefined;
    expect(formatRelativeTime(legacy, NOW)).toBeNull();
  });

  it("treats small clock skew as 'just now' instead of a future time", () => {
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe("just now");
  });
});

describe("formatAbsoluteTime", () => {
  it("returns a printable string for a real timestamp", () => {
    expect(formatAbsoluteTime(NOW)).toBeTruthy();
  });

  it("returns null for missing input", () => {
    expect(formatAbsoluteTime(undefined)).toBeNull();
  });
});
