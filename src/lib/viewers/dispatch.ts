export type ViewerId =
  | "pdf" | "docx" | "xlsx" | "csv"
  | "markdown" | "code" | "json"
  | "image" | "svg" | "html"
  | "video" | "audio"
  | "notebook" | "unknown";

const EXT_TO_VIEWER: Record<string, ViewerId> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx", xls: "xlsx",
  csv: "csv", tsv: "csv",
  md: "markdown", markdown: "markdown",
  txt: "code", log: "code", json: "json",
  js: "code", ts: "code", tsx: "code", jsx: "code", mjs: "code", cjs: "code",
  py: "code", r: "code", rmd: "code", do: "code",
  c: "code", cpp: "code", h: "code", hpp: "code",
  rs: "code", go: "code", java: "code", kt: "code", swift: "code",
  rb: "code", php: "code", sh: "code", bash: "code", zsh: "code",
  sql: "code", yaml: "code", yml: "code", toml: "code", xml: "code",
  html: "html", htm: "html",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image", ico: "image",
  svg: "svg",
  mp4: "video", mov: "video", webm: "video", mkv: "video",
  mp3: "audio", wav: "audio", ogg: "audio", flac: "audio", m4a: "audio",
  ipynb: "notebook",
};

const SIZE_CAPS_MB: Partial<Record<ViewerId, number>> = {
  pdf: 50, docx: 25, xlsx: 15, csv: 100, json: 10,
  image: 25, svg: 5, notebook: 20,
};

export function viewerForFilename(name: string): ViewerId {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_VIEWER[ext] ?? "unknown";
}

export function sizeCapMB(viewer: ViewerId): number | null {
  return SIZE_CAPS_MB[viewer] ?? null;
}

export function exceedsSizeCap(viewer: ViewerId, bytes: number | null): boolean {
  if (bytes == null) return false;
  const capMB = sizeCapMB(viewer);
  if (capMB == null) return false;
  return bytes > capMB * 1024 * 1024;
}
