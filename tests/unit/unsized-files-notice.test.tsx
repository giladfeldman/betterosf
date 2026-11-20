/**
 * Cross-model review 2026-11-19 (class: unknown is not zero). `planHasNoFiles` decides the
 * "This project has no files" message on the export and transfer screens; files OSF listed
 * without a size must not count as no files.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnsizedFilesNotice, planHasNoFiles } from "@/components/transition/UnsizedFilesNotice";

const file = { osfFileId: "a", path: "osfstorage/a.csv" };

describe("planHasNoFiles", () => {
  it("is true only when OSF listed nothing", () => {
    expect(planHasNoFiles({ files: [], unsizedFiles: [] })).toBe(true);
    expect(planHasNoFiles({ files: [], unsizedFiles: undefined })).toBe(true);
  });
  it("is false when the only files are unsized", () => {
    expect(planHasNoFiles({ files: [], unsizedFiles: [file] })).toBe(false);
  });
});

describe("UnsizedFilesNotice", () => {
  it("names each unsized file, capped at five with a count of the rest", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ osfFileId: `f${i}`, path: `p/${i}.csv` }));
    render(<UnsizedFilesNotice plan={{ unsizedFiles: many }} />);
    expect(screen.getByText(/did not report a size for 7 files/i)).toBeTruthy();
    expect(screen.getByText("p/4.csv")).toBeTruthy();
    expect(screen.queryByText("p/5.csv")).toBeNull();
    expect(screen.getByText(/and 2 more/)).toBeTruthy();
  });
  it("renders nothing when every file has a size", () => {
    const { container } = render(<UnsizedFilesNotice plan={{ unsizedFiles: [] }} />);
    expect(container.textContent).toBe("");
  });
});
