import type { SearchAst } from "./parser";

export type FilterPair = [field: string, value: string];

/**
 * Hard cap on the number of OR-union request branches a query may expand into.
 * A query like `(a OR b) AND (c OR d) AND …` has a Cartesian product of 2^k
 * branches; without a bound the cross-product below would blow up memory before
 * the caller ever slices it down. The caller (search.ts) also only fetches this
 * many branches, so capping here loses nothing and closes the DoS path.
 */
export const MAX_QUERY_BRANCHES = 5;

export type RequestPlan = {
  filters: FilterPair[];
};

export type CompiledQuery = {
  requests: RequestPlan[];      // each = one OSF fetch; multiple = OR'd, results union'd
  combine: "intersect" | "union"; // top-level combine semantics across requests
  exclusions: string[];          // tokens to remove from result set client-side
};

/**
 * Compile a parsed AST against a target OSF field (e.g. "title" for nodes/registrations,
 * "name" for files, "full_name" for users).
 *
 * Algorithm:
 * - Collect ALL positive terms via DFS, splitting on the top-level OR.
 * - Each branch of a top-level OR becomes one RequestPlan with all its AND-ed terms.
 * - If there's no top-level OR, produce a single RequestPlan with all ANDs.
 * - NOT terms anywhere are collected into `exclusions`.
 * - Nested OR inside an AND is "lifted" by distributing — (A OR B) AND C → (A AND C) OR (B AND C).
 *   We do this distribution shallowly (one level); deeper nesting collapses to a best-effort plan.
 */
export function compileQuery(ast: SearchAst, field: string): CompiledQuery {
  const exclusions: string[] = [];

  function collectExclusions(n: SearchAst): void {
    if (n.type === "not" && n.child.type === "term") {
      exclusions.push(n.child.value);
    } else if (n.type === "and" || n.type === "or") {
      for (const c of n.children) collectExclusions(c);
    }
  }

  function stripExclusions(n: SearchAst): SearchAst {
    if (n.type === "not") return { type: "and", children: [] };
    if (n.type === "and" || n.type === "or") {
      const kept = n.children.map(stripExclusions).filter((c) => !(c.type === "and" && c.children.length === 0));
      if (kept.length === 0) return { type: "and", children: [] };
      if (kept.length === 1) return kept[0]!;
      return { type: n.type, children: kept };
    }
    return n;
  }

  collectExclusions(ast);
  const stripped = stripExclusions(ast);

  // Distribute one level of OR through enclosing AND
  function flatten(n: SearchAst): SearchAst[] {
    // Returns an array of AND-only branches (each a list of terms)
    if (n.type === "term") return [n];
    if (n.type === "and") {
      // Each child is a list of branches; cross-product them. We early-bail once
      // the running product reaches MAX_QUERY_BRANCHES so a crafted nested-OR
      // query can't expand 2^k entries before the caller slices to the cap.
      const childBranches = n.children.map(flatten);
      let combined: SearchAst[][] = [[]];
      for (const branches of childBranches) {
        const next: SearchAst[][] = [];
        outer: for (const c of combined) {
          for (const b of branches) {
            // If b is itself an AND, splat its children; else push
            if (b.type === "and") next.push([...c, ...b.children]);
            else next.push([...c, b]);
            if (next.length >= MAX_QUERY_BRANCHES) break outer;
          }
        }
        combined = next;
      }
      return combined.map((branch) => branch.length === 1 ? branch[0]! : { type: "and", children: branch });
    }
    if (n.type === "or") {
      return n.children.flatMap(flatten);
    }
    return [];
  }

  // Cap the branch list itself (a flat top-level OR `a OR b OR c …` produces one
  // branch per term, so bound it here too — not just the AND cross-product above).
  const branches = flatten(stripped).slice(0, MAX_QUERY_BRANCHES);

  const requests: RequestPlan[] = branches.map((branch) => {
    const terms: SearchAst[] = branch.type === "and" ? branch.children : [branch];
    const filters: FilterPair[] = terms
      .filter((t): t is { type: "term"; value: string } => t.type === "term")
      .map((t) => [field, t.value]);
    return { filters };
  });

  return {
    requests: requests.length === 0 ? [{ filters: [] }] : requests,
    combine: requests.length > 1 ? "union" : "intersect",
    exclusions,
  };
}
