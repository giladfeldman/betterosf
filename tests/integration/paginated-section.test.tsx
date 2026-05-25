import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// PaginatedSection imports three client subcomponents that pull next/navigation.
// Mock them out to keep the test focused on PaginatedSection's slicing + URL building.
vi.mock("@/components/PageSizeSelector", () => ({
  PageSizeSelector: () => <div data-testid="page-size-selector" />,
}));
vi.mock("@/components/SortControl", () => ({
  SortControl: () => <div data-testid="sort-control" />,
}));
vi.mock("@/components/FilterChips", () => ({
  FilterChips: () => <div data-testid="filter-chips" />,
}));

import { PaginatedSection, parsePagination } from "@/components/PaginatedSection";

function makeItems(n: number): { id: string }[] {
  return Array.from({ length: n }).map((_, i) => ({ id: `i${i}` }));
}

describe("PaginatedSection slicing", () => {
  it("renders only the page slice [(page-1)*pageSize, page*pageSize)", () => {
    const items = makeItems(25);
    render(
      <PaginatedSection
        title="Items"
        prefKey="test"
        sortParamName="sort"
        sortOptions={[{ value: "a", label: "A" }]}
        items={items}
        totalUnfiltered={25}
        page={2}
        pageSize={10}
        renderItem={(item) => <li key={item.id}>{item.id}</li>}
        basePath="/x"
        searchParams={{}}
      />
    );
    // Page 2 of size 10 = items i10..i19
    expect(screen.getByText("i10")).toBeInTheDocument();
    expect(screen.getByText("i19")).toBeInTheDocument();
    expect(screen.queryByText("i9")).not.toBeInTheDocument();
    expect(screen.queryByText("i20")).not.toBeInTheDocument();
  });

  it("shows correct range label '11–20 of 25'", () => {
    render(
      <PaginatedSection
        title="Items"
        prefKey="test"
        sortParamName="sort"
        sortOptions={[]}
        items={makeItems(25)}
        totalUnfiltered={25}
        page={2}
        pageSize={10}
        renderItem={(item) => <li key={item.id}>{item.id}</li>}
        basePath="/x"
        searchParams={{}}
      />
    );
    expect(screen.getByText(/11.*20.*of.*25/)).toBeInTheDocument();
  });

  it("shows '(filtered from N)' when totalUnfiltered > items.length", () => {
    render(
      <PaginatedSection
        title="Items"
        prefKey="test"
        sortParamName="sort"
        sortOptions={[]}
        items={makeItems(8)}
        totalUnfiltered={100}
        page={1}
        pageSize={10}
        renderItem={(item) => <li key={item.id}>{item.id}</li>}
        basePath="/x"
        searchParams={{}}
      />
    );
    expect(screen.getByText(/Items \(8 \(filtered from 100\)\)/)).toBeInTheDocument();
  });

  it("Prev/Next links preserve unrelated query params (sort, filter, etc.)", () => {
    const items = makeItems(30);
    render(
      <PaginatedSection
        title="Items"
        prefKey="test"
        sortParamName="sort"
        sortOptions={[]}
        items={items}
        totalUnfiltered={30}
        page={2}
        pageSize={10}
        renderItem={(item) => <li key={item.id}>{item.id}</li>}
        basePath="/section"
        searchParams={{ sort: "name", scope: "public", size: "10" }}
      />
    );
    const prev = screen.getByRole("link", { name: /previous/i });
    const next = screen.getByRole("link", { name: /next/i });
    expect(prev).toHaveAttribute("href", expect.stringContaining("sort=name"));
    expect(prev).toHaveAttribute("href", expect.stringContaining("scope=public"));
    expect(prev).toHaveAttribute("href", expect.stringContaining("size=10"));
    expect(prev).toHaveAttribute("href", expect.stringContaining("page=1"));
    expect(next).toHaveAttribute("href", expect.stringContaining("page=3"));
    expect(next).toHaveAttribute("href", expect.stringContaining("scope=public"));
  });

  it("no Previous link on page 1; no Next link when on last page", () => {
    const items = makeItems(15);
    const { rerender } = render(
      <PaginatedSection
        title="Items"
        prefKey="t"
        sortParamName="sort"
        sortOptions={[]}
        items={items}
        totalUnfiltered={15}
        page={1}
        pageSize={10}
        renderItem={(item) => <li key={item.id}>{item.id}</li>}
        basePath="/x"
        searchParams={{}}
      />
    );
    expect(screen.queryByRole("link", { name: /previous/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /next/i })).toBeInTheDocument();

    rerender(
      <PaginatedSection
        title="Items"
        prefKey="t"
        sortParamName="sort"
        sortOptions={[]}
        items={items}
        totalUnfiltered={15}
        page={2}
        pageSize={10}
        renderItem={(item) => <li key={item.id}>{item.id}</li>}
        basePath="/x"
        searchParams={{}}
      />
    );
    expect(screen.getByRole("link", { name: /previous/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /next/i })).not.toBeInTheDocument();
  });

  it("empty items + custom emptyText renders the empty state", () => {
    render(
      <PaginatedSection
        title="Items"
        prefKey="t"
        sortParamName="sort"
        sortOptions={[]}
        items={[]}
        totalUnfiltered={0}
        page={1}
        pageSize={10}
        renderItem={(item: { id: string }) => <li key={item.id}>{item.id}</li>}
        emptyText="Nothing here yet"
        basePath="/x"
        searchParams={{}}
      />
    );
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
  });

  it("renders pagination links using the custom pageParamName", () => {
    const items = makeItems(30);
    render(
      <PaginatedSection
        title="Items"
        prefKey="t"
        pageParamName="cpage"
        sortParamName="sort"
        sortOptions={[]}
        items={items}
        totalUnfiltered={30}
        page={2}
        pageSize={10}
        renderItem={(item) => <li key={item.id}>{item.id}</li>}
        basePath="/x"
        searchParams={{}}
      />
    );
    const prev = screen.getByRole("link", { name: /previous/i });
    expect(prev).toHaveAttribute("href", expect.stringContaining("cpage=1"));
  });
});

describe("parsePagination", () => {
  it("defaults to page=1, pageSize=50", () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 50, sizeRaw: "" });
  });
  it("'all' maps to the all sentinel (default 500)", () => {
    expect(parsePagination({ size: "all" })).toEqual({ page: 1, pageSize: 500, sizeRaw: "all" });
  });
  it("custom positive size is respected", () => {
    expect(parsePagination({ size: "25", page: "3" })).toEqual({ page: 3, pageSize: 25, sizeRaw: "25" });
  });
  it("invalid size falls back to default", () => {
    expect(parsePagination({ size: "abc" })).toEqual({ page: 1, pageSize: 50, sizeRaw: "abc" });
  });
  it("negative or zero page falls back to 1", () => {
    expect(parsePagination({ page: "0" }).page).toBe(1);
    expect(parsePagination({ page: "-2" }).page).toBe(1);
  });
  it("custom paramNames are honored", () => {
    expect(parsePagination({ s: "10", p: "2" }, "s", "p")).toEqual({ page: 2, pageSize: 10, sizeRaw: "10" });
  });
});
