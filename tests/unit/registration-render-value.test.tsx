import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  renderValue,
  renderScalar,
  renderUploadedFile,
  isUploadedFile,
  type UploadedFile,
} from "@/lib/registrations/render-value";

describe("isUploadedFile", () => {
  it("recognises objects with file_name or file_id", () => {
    expect(isUploadedFile({ file_name: "a.pdf" })).toBe(true);
    expect(isUploadedFile({ file_id: "abc" })).toBe(true);
    expect(isUploadedFile({ file_name: "a.pdf", file_id: "abc", extra: 1 })).toBe(true);
  });
  it("rejects plain objects, primitives, null, and arrays", () => {
    expect(isUploadedFile({ foo: 1 })).toBe(false);
    expect(isUploadedFile("string")).toBe(false);
    expect(isUploadedFile(null)).toBe(false);
    expect(isUploadedFile(42)).toBe(false);
    expect(isUploadedFile([])).toBe(false);
  });
});

describe("renderValue — null/undefined", () => {
  it("null → em-dash", () => {
    const { container } = render(<>{renderValue(null)}</>);
    expect(container.textContent).toContain("—");
  });
  it("undefined → em-dash", () => {
    const { container } = render(<>{renderValue(undefined)}</>);
    expect(container.textContent).toContain("—");
  });
});

describe("renderValue — primitives", () => {
  it("boolean true → 'Yes'", () => {
    const { container } = render(<>{renderValue(true)}</>);
    expect(container.textContent).toBe("Yes");
  });
  it("boolean false → 'No'", () => {
    const { container } = render(<>{renderValue(false)}</>);
    expect(container.textContent).toBe("No");
  });
  it("number → stringified", () => {
    const { container } = render(<>{renderValue(42)}</>);
    expect(container.textContent).toBe("42");
  });
  it("short string (<=200) → simple span", () => {
    const { container } = render(<>{renderValue("hi there")}</>);
    expect(container.querySelector("p")).toBeNull();
    expect(container.textContent).toBe("hi there");
  });
  it("long string (>200) → <p> with whitespace-pre-wrap", () => {
    const long = "x".repeat(250);
    const { container } = render(<>{renderValue(long)}</>);
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.className).toMatch(/whitespace-pre-wrap/);
    expect(p!.textContent).toBe(long);
  });
});

describe("renderValue — arrays", () => {
  it("array of strings → unordered list with each as a <li>", () => {
    const { container } = render(<>{renderValue(["alpha", "beta", "gamma"])}</>);
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toBe("alpha");
    expect(items[2]!.textContent).toBe("gamma");
    const ul = container.querySelector("ul")!;
    expect(ul.className).toMatch(/list-disc/);
  });

  it("array of UploadedFile objects → file list with download links", () => {
    const files: UploadedFile[] = [
      { file_name: "a.pdf", file_urls: { html: "https://osf.io/a/", download: "https://osf.io/a/?dl=1" } },
      { file_id: "id-b" }, // no urls, no name
    ];
    const { container } = render(<>{renderValue(files)}</>);
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    // First item has an anchor with the html URL
    const firstA = items[0]!.querySelector("a")!;
    expect(firstA).not.toBeNull();
    expect(firstA.getAttribute("href")).toBe("https://osf.io/a/");
    expect(firstA.textContent).toBe("a.pdf");
    // Second item has no anchor (no urls) and falls back to file_id
    expect(items[1]!.querySelector("a")).toBeNull();
    expect(items[1]!.textContent).toContain("id-b");
  });

  it("mixed array (one UploadedFile, one string) is NOT treated as file array — falls through to scalar list", () => {
    const value = [{ file_name: "a.pdf" }, "just a string"];
    const { container } = render(<>{renderValue(value)}</>);
    // The array branch using renderScalar is taken; the file_name object becomes a <pre> JSON dump
    const ul = container.querySelector("ul")!;
    expect(ul.className).toMatch(/list-disc/);
    expect(container.querySelector("pre")).not.toBeNull();
  });

  it("empty array → empty list (no special file path)", () => {
    const { container } = render(<>{renderValue([])}</>);
    const ul = container.querySelector("ul")!;
    expect(ul).not.toBeNull();
    expect(ul.querySelectorAll("li")).toHaveLength(0);
  });
});

describe("renderValue — single UploadedFile (not in array)", () => {
  it("renders as a single-item list with a link", () => {
    const file: UploadedFile = { file_name: "x.csv", file_urls: { download: "https://osf.io/x/" } };
    const { container } = render(<>{renderValue(file)}</>);
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(1);
    expect(items[0]!.querySelector("a")!.getAttribute("href")).toBe("https://osf.io/x/");
  });
});

describe("renderValue — unknown object shape", () => {
  it("falls through to pretty-printed JSON <pre>", () => {
    const { container } = render(<>{renderValue({ weird: "shape", n: 1, deep: { a: 1 } })}</>);
    const pre = container.querySelector("pre")!;
    expect(pre).not.toBeNull();
    const json = JSON.parse(pre.textContent ?? "{}");
    expect(json).toEqual({ weird: "shape", n: 1, deep: { a: 1 } });
  });
});

describe("renderScalar direct usage", () => {
  it("delegates to renderValue's primitives logic", () => {
    const { container } = render(<>{renderScalar(123)}</>);
    expect(container.textContent).toBe("123");
  });
});

describe("renderUploadedFile direct usage", () => {
  it("uses file_name when present, else file_id, else 'unnamed'", () => {
    const a = render(<ul>{renderUploadedFile({ file_name: "n.txt" }, 1)}</ul>);
    expect(a.container.textContent).toContain("n.txt");

    const b = render(<ul>{renderUploadedFile({ file_id: "fid" }, 2)}</ul>);
    expect(b.container.textContent).toContain("fid");

    const c = render(<ul>{renderUploadedFile({}, 3)}</ul>);
    expect(c.container.textContent).toContain("unnamed");
  });

  it("prefers html URL over download URL", () => {
    const { container } = render(
      <ul>
        {renderUploadedFile(
          { file_name: "n", file_urls: { html: "HTML", download: "DOWN" } },
          1
        )}
      </ul>
    );
    expect(container.querySelector("a")!.getAttribute("href")).toBe("HTML");
  });
});
