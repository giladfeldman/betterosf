/**
 * Copies pdfjs-dist's worker to public/ so the PDF viewer can use a
 * same-origin worker URL instead of unpkg.com. Runs as the prebuild step.
 *
 * Why: on 2026-05-26 the PDF viewer broke on production because the hardcoded
 * URL `https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.js` returned
 * 404 — pdfjs-dist v5 ships only `.mjs` workers, and any unpkg outage would
 * also have killed the viewer. Self-hosting solves both issues.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const src = resolve(projectRoot, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const dstDir = resolve(projectRoot, "public");
const dst = resolve(dstDir, "pdf.worker.min.mjs");

if (!existsSync(src)) {
  console.error(`copy-pdfjs-worker: source missing: ${src}`);
  console.error("  Is pdfjs-dist installed? Run `npm ci` first.");
  process.exit(1);
}

mkdirSync(dstDir, { recursive: true });
copyFileSync(src, dst);
console.log(`copy-pdfjs-worker: ${src.replace(projectRoot, "")} -> ${dst.replace(projectRoot, "")}`);
