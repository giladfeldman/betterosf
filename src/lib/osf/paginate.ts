export type Page<T> = {
  data: T[];
  links: { next: string | null };
};

export type Fetcher<T> = (nextUrl?: string) => Promise<Page<T>>;

export async function collectAll<T>(
  fetcher: Fetcher<T>,
  opts: { maxPages?: number } = {}
): Promise<T[]> {
  const maxPages = opts.maxPages ?? 200;
  const out: T[] = [];
  let nextUrl: string | undefined = undefined;
  let pages = 0;
  while (true) {
    const page = await fetcher(nextUrl);
    out.push(...page.data);
    pages += 1;
    if (!page.links.next) return out;
    if (pages >= maxPages) throw new Error(`collectAll: maxPages ${maxPages} exceeded`);
    nextUrl = page.links.next;
  }
}
