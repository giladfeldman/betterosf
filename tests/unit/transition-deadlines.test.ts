// Date arithmetic for the transition countdown.
//
// A countdown that is off by one, or that flips to "passed" a day early, would push a
// researcher to rush an irreversible decision. Timezone handling is the usual culprit,
// so the boundaries are tested explicitly rather than assumed.

import { describe, it, expect } from "vitest";
import {
  TRANSITION_DEADLINES,
  daysUntil,
  deadlineStatus,
  nextDeadline,
  describeDeadline,
} from "@/lib/transition/deadlines";

const READ_ONLY = "2027-02-19";

describe("TRANSITION_DEADLINES", () => {
  it("carries both announced dates, in order, as ISO dates", () => {
    expect(TRANSITION_DEADLINES.map((d) => d.date)).toEqual(["2026-11-16", "2027-02-19"]);
    for (const d of TRANSITION_DEADLINES) expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has unique ids", () => {
    const ids = TRANSITION_DEADLINES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("daysUntil", () => {
  it("counts whole days", () => {
    expect(daysUntil(READ_ONLY, new Date("2027-02-18T00:00:00Z"))).toBe(1);
    expect(daysUntil(READ_ONLY, new Date("2027-02-12T00:00:00Z"))).toBe(7);
  });

  it("is 0 on the day itself, at any hour", () => {
    expect(daysUntil(READ_ONLY, new Date("2027-02-19T00:00:00Z"))).toBe(0);
    expect(daysUntil(READ_ONLY, new Date("2027-02-19T23:59:59Z"))).toBe(0);
  });

  it("does not flip early late in the previous day", () => {
    // The off-by-one that a naive (target - now) / 86400000 would produce.
    expect(daysUntil(READ_ONLY, new Date("2027-02-18T23:59:59Z"))).toBe(1);
  });

  it("goes negative after the date", () => {
    expect(daysUntil(READ_ONLY, new Date("2027-02-20T12:00:00Z"))).toBe(-1);
  });

  it("crosses a month and a leap-year boundary correctly", () => {
    expect(daysUntil("2028-03-01", new Date("2028-02-28T00:00:00Z"))).toBe(2); // 2028 is a leap year
    expect(daysUntil("2026-12-01", new Date("2026-11-30T00:00:00Z"))).toBe(1);
  });

  it("throws on a malformed date rather than returning NaN", () => {
    expect(() => daysUntil("not-a-date", new Date())).toThrow(/ISO date/);
  });
});

describe("deadlineStatus", () => {
  it("treats the day itself as not yet passed", () => {
    expect(deadlineStatus(READ_ONLY, new Date("2027-02-19T18:00:00Z"))).toBe("today");
  });

  it("distinguishes upcoming from passed", () => {
    expect(deadlineStatus(READ_ONLY, new Date("2027-01-01T00:00:00Z"))).toBe("upcoming");
    expect(deadlineStatus(READ_ONLY, new Date("2027-03-01T00:00:00Z"))).toBe("passed");
  });
});

describe("nextDeadline", () => {
  it("is the first announced date well beforehand", () => {
    expect(nextDeadline(new Date("2026-08-13T00:00:00Z"))?.id).toBe("no-new-projects");
  });

  it("moves to the second once the first has passed", () => {
    expect(nextDeadline(new Date("2026-11-17T00:00:00Z"))?.id).toBe("read-only");
  });

  it("still reports a deadline falling today", () => {
    expect(nextDeadline(new Date("2026-11-16T09:00:00Z"))?.id).toBe("no-new-projects");
  });

  it("is null once every deadline has passed", () => {
    expect(nextDeadline(new Date("2030-01-01T00:00:00Z"))).toBeNull();
  });
});

describe("describeDeadline", () => {
  it("uses singular for one day", () => {
    expect(describeDeadline(READ_ONLY, new Date("2027-02-18T00:00:00Z"))).toBe("in 1 day");
    expect(describeDeadline(READ_ONLY, new Date("2027-02-20T00:00:00Z"))).toBe("1 day ago");
  });

  it("says today on the day", () => {
    expect(describeDeadline(READ_ONLY, new Date("2027-02-19T05:00:00Z"))).toBe("today");
  });

  it("gives an exact number, not a vague one", () => {
    expect(describeDeadline(READ_ONLY, new Date("2026-08-13T00:00:00Z"))).toBe("in 190 days");
  });
});
