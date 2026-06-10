import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import InformationPage from "@/app/information/page";
import { redirect } from "next/navigation";

describe("/information", () => {
  it("permanently redirects to /about", () => {
    expect(() => InformationPage()).toThrow("NEXT_REDIRECT:/about");
    expect(redirect).toHaveBeenCalledWith("/about");
  });
});
