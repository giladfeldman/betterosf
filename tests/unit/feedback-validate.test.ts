/**
 * Validation rules for user bug reports (feature requested 2026-08-04, modelled
 * on codanote.app).
 *
 * The failure mode that matters here is SILENT LOSS: a real user hits a real bug,
 * takes the trouble to write it up, and an over-strict rule throws it away. These
 * tests pin that reports are accepted generously and only obvious junk is
 * rejected — and that rejection always returns a reason, never a silent drop.
 */
import { describe, it, expect } from "vitest";
import {
  validateFeedback,
  truncateUserAgent,
  MAX_MESSAGE_LEN,
  MIN_MESSAGE_LEN,
} from "@/lib/feedback/validate";

describe("feedback validation accepts real reports", () => {
  it("accepts a plain bug report with nothing but a message", () => {
    const r = validateFeedback({ message: "The tree does not load on 3kmr9." });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.message).toBe("The tree does not load on 3kmr9.");
      expect(r.value.kind).toBe("bug"); // sensible default
      expect(r.value.contactEmail).toBeNull();
    }
  });

  it("keeps a valid contact email, lowercased and trimmed", () => {
    const r = validateFeedback({ message: "something broke", contactEmail: "  Gilad@Example.COM " });
    expect(r.ok && r.value.contactEmail).toBe("gilad@example.com");
  });

  it("preserves the reporting page URL (the highest-signal field after the text)", () => {
    const r = validateFeedback({
      message: "blank viewer here",
      pageUrl: "/3kmr9/files/view/osfstorage/test.txt",
    });
    expect(r.ok && r.value.pageUrl).toBe("/3kmr9/files/view/osfstorage/test.txt");
  });

  it("accepts the non-bug kinds", () => {
    for (const kind of ["idea", "question"]) {
      const r = validateFeedback({ message: "a thought about this", kind });
      expect(r.ok && r.value.kind).toBe(kind);
    }
  });

  it("falls back to 'bug' for an unrecognised kind rather than rejecting", () => {
    const r = validateFeedback({ message: "valid message here", kind: "nonsense" });
    expect(r.ok && r.value.kind).toBe("bug");
  });

  it("accepts a message exactly at the maximum length", () => {
    expect(validateFeedback({ message: "x".repeat(MAX_MESSAGE_LEN) }).ok).toBe(true);
  });
});

describe("feedback validation rejects only junk, and always says why", () => {
  it("rejects an empty or too-short message with an actionable reason", () => {
    for (const message of ["", "   ", "hi"]) {
      const r = validateFeedback({ message });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
    }
  });

  it("rejects a message just under the minimum but accepts it at the boundary", () => {
    expect(validateFeedback({ message: "x".repeat(MIN_MESSAGE_LEN - 1) }).ok).toBe(false);
    expect(validateFeedback({ message: "x".repeat(MIN_MESSAGE_LEN) }).ok).toBe(true);
  });

  it("rejects a message over the maximum length", () => {
    expect(validateFeedback({ message: "x".repeat(MAX_MESSAGE_LEN + 1) }).ok).toBe(false);
  });

  it("tolerates non-string junk without throwing", () => {
    expect(validateFeedback({ message: null }).ok).toBe(false);
    expect(validateFeedback({ message: 42 }).ok).toBe(false);
    expect(validateFeedback({}).ok).toBe(false);
    // A valid message with junk in the optional fields still succeeds.
    const r = validateFeedback({ message: "a real report", contactEmail: 5, pageUrl: {} });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.contactEmail).toBeNull();
      expect(r.value.pageUrl).toBeNull();
    }
  });
});

describe("optional fields are sanitised, never trusted", () => {
  it("drops a malformed email instead of failing the whole report", () => {
    const r = validateFeedback({ message: "real problem here", contactEmail: "not-an-email" });
    // The report SURVIVES — losing it over a typo'd email would be the worst outcome.
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.contactEmail).toBeNull();
  });

  it("drops a javascript: page URL so it can never render as a link in the admin UI", () => {
    const r = validateFeedback({
      message: "check this out",
      // eslint-disable-next-line no-script-url
      pageUrl: "javascript:alert(1)",
    });
    expect(r.ok && r.value.pageUrl).toBeNull();
  });

  it("drops a data: URL for the same reason", () => {
    const r = validateFeedback({ message: "check this out", pageUrl: "data:text/html,<script>" });
    expect(r.ok && r.value.pageUrl).toBeNull();
  });

  it("keeps ordinary same-origin http(s) URLs", () => {
    const r = validateFeedback({ message: "broken here", pageUrl: "https://betterosf.vercel.app/3kmr9" });
    expect(r.ok && r.value.pageUrl).toBe("https://betterosf.vercel.app/3kmr9");
  });

  /**
   * Found by cross-model review (codex, 2026-08-04) and reproduced before fixing:
   * `new URL("//evil.example/x", "http://localhost:4747")` resolves to
   * `http://evil.example/x`. A protocol-relative URL LOOKS like a path but is a
   * different origin, so an anonymous reporter could plant a phishing link that
   * renders as a trusted clickable link in the admin inbox — aimed squarely at
   * the one person who reads every report.
   */
  it("rejects a protocol-relative //host URL that would render as an off-site link", () => {
    const r = validateFeedback({ message: "look at this page", pageUrl: "//evil.example/phish" });
    expect(r.ok && r.value.pageUrl).toBeNull();
  });

  it("rejects backslash and mixed-slash variants of the same trick", () => {
    for (const u of ["\\\\evil.example/phish", "/\\evil.example", "\\/evil.example"]) {
      const r = validateFeedback({ message: "look at this page", pageUrl: u });
      expect(r.ok && r.value.pageUrl, `should reject ${u}`).toBeNull();
    }
  });

  it("rejects an absolute URL pointing at a host that is not BetterOSF", () => {
    const r = validateFeedback({ message: "look at this", pageUrl: "https://evil.example/phish" });
    expect(r.ok && r.value.pageUrl).toBeNull();
  });

  it("still accepts genuine relative paths", () => {
    for (const u of ["/3kmr9", "/3kmr9/files/view/osfstorage/a.txt", "/"]) {
      const r = validateFeedback({ message: "a real report", pageUrl: u });
      expect(r.ok && r.value.pageUrl, `should keep ${u}`).toBe(u);
    }
  });
});

describe("truncateUserAgent", () => {
  it("returns null for a missing UA rather than an empty string", () => {
    expect(truncateUserAgent(null)).toBeNull();
    expect(truncateUserAgent(undefined)).toBeNull();
    expect(truncateUserAgent("")).toBeNull();
  });

  it("caps an absurdly long UA", () => {
    expect(truncateUserAgent("u".repeat(5000))!.length).toBeLessThanOrEqual(500);
  });
});
