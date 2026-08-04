/**
 * User report 2026-08-04: "pointing to the .txt file isn't showing anything,
 * including no content of the file. we need to have a display for text files."
 *
 * `test.txt` on 3kmr9 is genuinely 0 bytes (confirmed against the OSF API), and
 * the download proxy returns it correctly with a 200. The defect was purely
 * presentational: CodeViewer piped the empty string through Shiki, which emits a
 * `<pre>` containing ZERO visible characters. The result is a blank pane that is
 * indistinguishable from a crashed viewer — the user cannot tell "this file is
 * empty" from "this app is broken".
 *
 * A viewer that renders nothing for valid content is a reporting failure, not a
 * cosmetic one: it hides the true state of the data.
 *
 * These tests pin that every text file reaches a viewer, and that an empty file
 * states plainly that it IS empty.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { viewerForFilename } from "@/lib/viewers/dispatch";
import { TextMeta, isBlankText } from "@/components/viewers/TextMeta";

describe("text-like files route to a real viewer (never 'unknown')", () => {
  const textFiles = [
    "notes.txt",
    "README.md",
    "run.log",
    "data.csv",
    "script.R",
    "config.yaml",
    "survey.qsf",
  ];
  for (const name of textFiles) {
    it(`${name} does not fall through to the download fallback`, () => {
      expect(viewerForFilename(name)).not.toBe("unknown");
    });
  }

  it("plain .txt maps to the code/text viewer", () => {
    expect(viewerForFilename("test.txt")).toBe("code");
  });

  it("is case-insensitive about the extension", () => {
    expect(viewerForFilename("NOTES.TXT")).toBe("code");
    expect(viewerForFilename("READ.MD")).toBe("markdown");
  });
});

describe("blank-content detection", () => {
  it("treats a 0-byte file as blank", () => {
    expect(isBlankText("")).toBe(true);
  });

  it("treats whitespace-only content as blank (it renders as nothing too)", () => {
    expect(isBlankText("   ")).toBe(true);
    expect(isBlankText("\n\n\t  \r\n")).toBe(true);
  });

  it("does NOT treat real content as blank", () => {
    expect(isBlankText("hello")).toBe(false);
    expect(isBlankText("0")).toBe(false); // falsy string, but real content
    expect(isBlankText(" x ")).toBe(false);
  });
});

describe("TextMeta tells the user what they are looking at", () => {
  it("says the file is empty when it has no content (THE regression)", () => {
    render(<TextMeta filename="test.txt" text="" sizeBytes={0} />);
    // The whole point: an empty file must SAY it is empty.
    expect(screen.getByText(/this file is empty/i)).toBeInTheDocument();
  });

  it("reports the byte size so 0 B is visible and unambiguous", () => {
    render(<TextMeta filename="test.txt" text="" sizeBytes={0} />);
    expect(screen.getByText(/0 B/)).toBeInTheDocument();
  });

  it("shows line and character counts for a non-empty file", () => {
    render(<TextMeta filename="notes.txt" text={"alpha\nbeta\ngamma"} sizeBytes={16} />);
    expect(screen.getByText(/3 lines/)).toBeInTheDocument();
    expect(screen.queryByText(/this file is empty/i)).toBeNull();
  });

  it("counts a single line without a trailing newline correctly", () => {
    render(<TextMeta filename="a.txt" text="only one line" sizeBytes={13} />);
    expect(screen.getByText(/1 line\b/)).toBeInTheDocument();
  });

  it("flags whitespace-only files, which would otherwise look identical to empty", () => {
    render(<TextMeta filename="ws.txt" text={"   \n  "} sizeBytes={6} />);
    expect(screen.getByText(/only whitespace/i)).toBeInTheDocument();
  });
});
