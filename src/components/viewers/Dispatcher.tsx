"use client";

import dynamic from "next/dynamic";
import { viewerForFilename, exceedsSizeCap, type ViewerId } from "@/lib/viewers/dispatch";
import { DownloadFallback } from "./DownloadFallback";

const Pdf = dynamic(() => import("./PdfViewer").then((m) => m.PdfViewer), { ssr: false, loading: () => <div className="p-4">Loading PDF viewer…</div> });
const Docx = dynamic(() => import("./DocxViewer").then((m) => m.DocxViewer), { ssr: false });
const Pptx = dynamic(() => import("./PptxViewer").then((m) => m.PptxViewer), { ssr: false });
const Xlsx = dynamic(() => import("./XlsxViewer").then((m) => m.XlsxViewer), { ssr: false });
const Csv = dynamic(() => import("./CsvViewer").then((m) => m.CsvViewer), { ssr: false });
const Markdown = dynamic(() => import("./MarkdownViewer").then((m) => m.MarkdownViewer), { ssr: false });
const Code = dynamic(() => import("./CodeViewer").then((m) => m.CodeViewer), { ssr: false });
const Json = dynamic(() => import("./JsonViewer").then((m) => m.JsonViewer), { ssr: false });
const Image = dynamic(() => import("./ImageViewer").then((m) => m.ImageViewer), { ssr: false });
const Svg = dynamic(() => import("./SvgViewer").then((m) => m.SvgViewer), { ssr: false });
const Html = dynamic(() => import("./HtmlViewer").then((m) => m.HtmlViewer), { ssr: false });
const Video = dynamic(() => import("./VideoViewer").then((m) => m.VideoViewer), { ssr: false });
const Audio = dynamic(() => import("./AudioViewer").then((m) => m.AudioViewer), { ssr: false });
const Notebook = dynamic(() => import("./NotebookViewer").then((m) => m.NotebookViewer), { ssr: false });

export function ViewerDispatcher({
  filename,
  url,
  sizeBytes,
  forceOpen = false,
}: {
  filename: string;
  url: string;
  sizeBytes: number | null;
  forceOpen?: boolean;
}) {
  const viewer: ViewerId = viewerForFilename(filename);

  if (!forceOpen && exceedsSizeCap(viewer, sizeBytes)) {
    return (
      <DownloadFallback
        filename={filename}
        downloadUrl={url}
        sizeBytes={sizeBytes}
        reason="too-large"
        forceOpenHref={`?force=1`}
      />
    );
  }

  switch (viewer) {
    case "pdf": return <Pdf url={url} />;
    case "docx": return <Docx url={url} />;
    case "pptx": return <Pptx url={url} filename={filename} />;
    case "xlsx": return <Xlsx url={url} />;
    case "csv": return <Csv url={url} />;
    case "markdown": return <Markdown url={url} />;
    case "code": return <Code url={url} filename={filename} />;
    case "json": return <Json url={url} />;
    case "image": return <Image url={url} alt={filename} />;
    case "svg": return <Svg url={url} alt={filename} />;
    case "html": return <Html url={url} />;
    case "video": return <Video url={url} />;
    case "audio": return <Audio url={url} />;
    case "notebook": return <Notebook url={url} />;
    default:
      return <DownloadFallback filename={filename} downloadUrl={url} sizeBytes={sizeBytes} reason="unknown-format" />;
  }
}
