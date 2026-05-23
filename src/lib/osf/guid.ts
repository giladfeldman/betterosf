const GUID_RE = /^[a-zA-Z0-9]{2,8}$/;

export function isValidGuid(s: string): boolean {
  return GUID_RE.test(s);
}

export function parseOsfUrl(input: string): string | null {
  const trimmed = input.trim();
  if (isValidGuid(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (!/(^|\.)osf\.io$/i.test(url.hostname)) return null;
    const first = url.pathname.split("/").filter(Boolean)[0];
    if (first && isValidGuid(first)) return first;
    return null;
  } catch {
    return null;
  }
}
