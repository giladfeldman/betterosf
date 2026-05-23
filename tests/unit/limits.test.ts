import { describe, it, expect, beforeEach } from "vitest";
import { incrementDaily, incrementWindow, getCount, _resetForTests } from "@/lib/limits";

describe("limits (in-memory fallback)", () => {
  beforeEach(() => _resetForTests());

  it("incrementDaily returns 1, then 2, then 3", async () => {
    expect(await incrementDaily("app:osf:calls")).toBe(1);
    expect(await incrementDaily("app:osf:calls")).toBe(2);
    expect(await incrementDaily("app:osf:calls")).toBe(3);
  });

  it("getCount returns 0 for missing keys", async () => {
    expect(await getCount("never:incremented")).toBe(0);
  });

  it("getCount returns current value", async () => {
    await incrementDaily("app:osf:calls");
    await incrementDaily("app:osf:calls");
    expect(await getCount("app:osf:calls")).toBe(2);
  });

  it("incrementWindow respects window key independence", async () => {
    expect(await incrementWindow("ip:1.2.3.4", 60)).toBe(1);
    expect(await incrementWindow("ip:1.2.3.4", 60)).toBe(2);
    expect(await incrementWindow("ip:5.6.7.8", 60)).toBe(1);
  });
});
