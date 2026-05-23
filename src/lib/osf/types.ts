// Minimal JSON:API subset we care about
export type JsonApiResource<TAttr = unknown, TRel = unknown> = {
  id: string;
  type: string;
  attributes: TAttr;
  relationships?: TRel;
  links?: Record<string, string>;
};

export type JsonApiCollection<TAttr = unknown, TRel = unknown> = {
  data: JsonApiResource<TAttr, TRel>[];
  links: { next: string | null; prev?: string | null; first?: string; last?: string };
  meta?: { total?: number; per_page?: number };
};

export type JsonApiSingle<TAttr = unknown, TRel = unknown> = {
  data: JsonApiResource<TAttr, TRel>;
};

export class OsfError extends Error {
  constructor(
    public status: number,
    public code: "not_found" | "forbidden" | "rate_limited" | "upstream" | "unknown",
    message: string
  ) {
    super(message);
    this.name = "OsfError";
  }
}
