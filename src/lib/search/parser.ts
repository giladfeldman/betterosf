export type SearchAst =
  | { type: "term"; value: string; phrase?: boolean }
  | { type: "and"; children: SearchAst[] }
  | { type: "or"; children: SearchAst[] }
  | { type: "not"; child: SearchAst };

type Token = { kind: "word" | "phrase" | "lparen" | "rparen" | "or" | "and" | "minus"; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "(") { tokens.push({ kind: "lparen", value: "(" }); i++; continue; }
    if (ch === ")") { tokens.push({ kind: "rparen", value: ")" }); i++; continue; }
    if (ch === "-" && (i === 0 || /[\s(]/.test(s[i - 1] ?? " "))) {
      tokens.push({ kind: "minus", value: "-" }); i++; continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      tokens.push({ kind: "phrase", value: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    // Read a word until whitespace or special char
    let j = i;
    while (j < s.length && !/[\s()"]/.test(s[j]!)) j++;
    const word = s.slice(i, j);
    if (word.toUpperCase() === "OR") tokens.push({ kind: "or", value: "OR" });
    else if (word.toUpperCase() === "AND") tokens.push({ kind: "and", value: "AND" });
    else tokens.push({ kind: "word", value: word });
    i = j;
  }
  return tokens;
}

class Parser {
  pos = 0;
  constructor(public tokens: Token[]) {}
  peek(): Token | undefined { return this.tokens[this.pos]; }
  consume(): Token | undefined { return this.tokens[this.pos++]; }

  parseExpr(): SearchAst {
    let left = this.parseTerm();
    while (this.peek()?.kind === "or") {
      this.consume();
      const right = this.parseTerm();
      if (left.type === "or") left.children.push(right);
      else left = { type: "or", children: [left, right] };
    }
    return left;
  }

  parseTerm(): SearchAst {
    const children: SearchAst[] = [];
    while (this.peek() && this.peek()!.kind !== "or" && this.peek()!.kind !== "rparen") {
      if (this.peek()!.kind === "and") { this.consume(); continue; }
      children.push(this.parseFactor());
    }
    if (children.length === 0) return { type: "and", children: [] };
    if (children.length === 1) return children[0]!;
    return { type: "and", children };
  }

  parseFactor(): SearchAst {
    const t = this.peek();
    if (!t) return { type: "and", children: [] };
    if (t.kind === "minus") {
      this.consume();
      return { type: "not", child: this.parseFactor() };
    }
    if (t.kind === "lparen") {
      this.consume();
      const inner = this.parseExpr();
      if (this.peek()?.kind === "rparen") this.consume();
      return inner;
    }
    if (t.kind === "phrase") {
      this.consume();
      return { type: "term", value: t.value, phrase: true };
    }
    if (t.kind === "word") {
      this.consume();
      return { type: "term", value: t.value };
    }
    // Unexpected — skip and continue
    this.consume();
    return { type: "and", children: [] };
  }
}

export function parseQuery(input: string): SearchAst {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) return { type: "and", children: [] };
  const p = new Parser(tokens);
  return p.parseExpr();
}
