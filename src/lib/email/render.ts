import type { ReactElement, ReactNode } from "react";

/** Hand-rolled JSX→HTML walker — never import react-dom/server (RSC/Turbopack). */
export async function renderEmail(element: ReactElement): Promise<{ html: string; text: string }> {
  const html = "<!doctype html>" + renderNode(element);
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function renderNode(node: ReactNode): string {
  if (node === null || node === undefined || node === false || node === true) return "";
  if (typeof node === "string") return escapeHtml(node);
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderNode).join("");

  const el = node as { type: unknown; props: Record<string, unknown> };
  const { type, props } = el;

  if (typeof type === "symbol" || (type as { displayName?: string })?.displayName === "Fragment") {
    return renderNode((props?.children ?? null) as ReactNode);
  }

  if (typeof type === "function") {
    const Component = type as (p: typeof props) => ReactNode;
    return renderNode(Component(props));
  }

  if (typeof type === "string") {
    const tag = type.toLowerCase();
    const attrs = renderAttrs(props);
    if (VOID.has(tag)) return `<${tag}${attrs} />`;
    const children = renderNode((props?.children ?? null) as ReactNode);
    return `<${tag}${attrs}>${children}</${tag}>`;
  }

  return "";
}

function renderAttrs(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "key" || key === "ref") continue;
    if (value === null || value === undefined || value === false) continue;
    const attr = reactKeyToHtml(key);
    if (key === "style" && typeof value === "object") {
      parts.push(`style="${escapeAttr(styleObjectToCss(value as Record<string, unknown>))}"`);
      continue;
    }
    if (value === true) {
      parts.push(attr);
      continue;
    }
    parts.push(`${attr}="${escapeAttr(String(value))}"`);
  }
  return parts.length === 0 ? "" : " " + parts.join(" ");
}

function reactKeyToHtml(key: string): string {
  if (key === "className") return "class";
  if (key === "htmlFor") return "for";
  if (key === "charSet") return "charset";
  return key;
}

function styleObjectToCss(style: Record<string, unknown>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(style)) {
    if (v === null || v === undefined || v === false) continue;
    const prop = k.replace(/([A-Z])/g, "-$1").toLowerCase();
    const val = typeof v === "number" && !unitlessCss.has(k) ? `${v}px` : String(v);
    out.push(`${prop}: ${val}`);
  }
  return out.join("; ");
}

const unitlessCss = new Set([
  "animationIterationCount", "fontWeight", "lineHeight", "opacity", "order", "zIndex", "flex",
  "flexGrow", "flexShrink",
]);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
