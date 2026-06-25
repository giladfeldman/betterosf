// Build a safe `Content-Disposition: attachment` header value.
//
// A filename derived from an OSF project title or a path segment can contain `"`,
// CR/LF, or other bytes that would break out of the `filename="…"` token and let
// an attacker inject header content (needs a crafted name + a victim click, but
// it's free to close). We emit BOTH:
//   - a sanitized ASCII `filename=` fallback (quotes/control chars stripped), and
//   - an RFC 5987 `filename*=UTF-8''…` with every non-attr-char percent-encoded,
// which modern browsers prefer and which cannot carry raw delimiters.

/** Percent-encode per RFC 5987 attr-char rules (everything that isn't a safe token char). */
function rfc5987Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/** ASCII fallback: drop control chars, backslashes and quotes; collapse the rest. */
function asciiFallback(value: string): string {
  // Strip anything outside printable ASCII and the chars that would break the quoted token.
  const cleaned = Array.from(value)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) return "_"; // control chars incl. CR/LF/HT
      if (ch === '"' || ch === "\\") return "_";
      if (code > 0x7e) return "_"; // non-ASCII → underscore (filename* carries the real name)
      return ch;
    })
    .join("")
    .trim();
  return cleaned || "download";
}

/**
 * Returns a full `Content-Disposition` header value for a download with `filename`.
 * @param filename the desired (possibly untrusted) filename
 * @param disposition "attachment" (default) or "inline"
 */
export function contentDisposition(filename: string, disposition: "attachment" | "inline" = "attachment"): string {
  return `${disposition}; filename="${asciiFallback(filename)}"; filename*=UTF-8''${rfc5987Encode(filename)}`;
}
