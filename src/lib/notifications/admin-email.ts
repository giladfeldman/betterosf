/**
 * Portfolio admin-email reference renderer (TypeScript). Spec: ./STANDARD.md.
 * Pure functions, zero dependencies, no react-dom. Copy this file into a host
 * (website-upgrade packs do it for you) and wire storage + SES around it.
 * Python twin: ./admin_email.py — keep the two in step (STANDARD_VERSION).
 */
import { createHash } from "node:crypto";

export const STANDARD_VERSION = 1;
export const SESSION_URL_CAP = 1900;

export type Priority = "P1" | "P2" | "P3" | "P4";
export const PRIORITY_LABEL: Record<Priority, string> = {
  P1: "CRITICAL", P2: "HIGH", P3: "MEDIUM", P4: "LOW",
};
const COLOR: Record<Priority | "OK", string> = {
  P1: "#a32020", P2: "#c2410c", P3: "#a86400", P4: "#5a6570", OK: "#1f7a4d",
};
const FONT = "Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const INK = "#1c1e21", SUB = "#5f6368", LINE = "#e3e5e8", PAGE = "#f4f5f7", CARD = "#ffffff";

export interface Importance {
  usersAffected?: string;   // "1", "all", "unknown"
  scienceAffected?: "yes" | "no" | "unknown";
  moneyAffected?: "yes" | "no" | "unknown";
  dataAtRisk?: "yes" | "no" | "unknown";
}

export interface AdminIssue {
  app: string;
  priority: Priority;
  summary: string;              // one line
  explanation: string;          // 2-3 plain sentences
  event: string;
  message?: string;
  errorClass?: string;
  route?: string;
  httpStatus?: number;
  requestId?: string;
  firstSeen: string;            // ISO
  lastSeen: string;             // ISO
  count: number;
  countSinceLastAlert?: number;
  fingerprint: string;
  environment: string;          // production | preview | local ...
  platform?: string;            // vercel | railway | render | local
  release?: string;
  userRef?: string;             // hashed id, never PII
  stack?: string;
  source?: string;              // "error log" | "user report" | "monitor"
  suggestedStep?: string;
  importance?: Importance;
  adminLogUrl?: string;
  platformLogUrl?: string;
}

export interface DigestInput {
  app: string;
  environment: string;
  periodStart: string;          // ISO
  periodEnd: string;            // ISO
  open: AdminIssue[];
  resolved: { summary: string; fingerprint: string; resolvedAt: string }[];
  noise: { event: string; count: number }[];
  numbers: { label: string; value: string | number }[];  // from the DB only
  alertingHealth: { label: string; value: string }[];
  adminUrl?: string;
}

// ---------------------------------------------------------------- helpers
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function normaliseMessage(msg: string): string {
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#")
    .replace(/\b[0-9a-f]{16,}\b/gi, "#")
    .replace(/\d+/g, "#")
    .trim()
    .slice(0, 200);
}

export function fingerprint(app: string, event: string, errorClass = "",
                            message = "", route = ""): string {
  return createHash("sha1")
    .update([app, event, errorClass, normaliseMessage(message), route].join("|"))
    .digest("hex").slice(0, 12);
}

/** Default classifier; hosts override per event. level: error|warn|fatal|info */
export function classify(level: string, opts: { userFacing?: boolean;
  countLastHour?: number; securityOrData?: boolean; down?: boolean } = {}): Priority {
  if (opts.down || opts.securityOrData || level === "fatal") return "P1";
  if (level === "error" && (opts.countLastHour ?? 0) >= 5) return "P2";
  if (level === "error" && opts.userFacing) return "P2";
  if (level === "error") return "P3";
  return "P4";
}

/** Throttle decision (STANDARD §5). lastAlertedAt null = never alerted. */
export function shouldAlert(p: Priority, lastAlertedAt: Date | null,
                            alertsToday: number, now = new Date()): boolean {
  if (p === "P4") return false;
  if (alertsToday >= 10) return false;
  if (!lastAlertedAt) return true;
  return now.getTime() - lastAlertedAt.getTime() >= 24 * 3600 * 1000;
}

/** Environment label from the platform marker, never NODE_ENV (STANDARD §6). */
export function environmentLabel(env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL_ENV) return env.VERCEL_ENV;
  if (env.RAILWAY_ENVIRONMENT_NAME) return env.RAILWAY_ENVIRONMENT_NAME;
  if (env.RENDER) return env.IS_PULL_REQUEST === "true" ? "preview" : "production";
  return "local";
}

export function emailPolicy(environment: string,
  env: Record<string, string | undefined> = process.env): { send: boolean; prefix: string } {
  if (environment === "production") return { send: true, prefix: "" };
  if (env.ALERT_EMAILS_NON_PRODUCTION === "1") {
    const tag = environment === "local" ? "LOCAL TEST" : environment.toUpperCase();
    return { send: true, prefix: `[${tag} - NOT PRODUCTION] ` };
  }
  return { send: false, prefix: "" };
}

export function sessionPrompt(i: AdminIssue): string {
  const stackTop = (i.stack ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
    .slice(0, 3).join(" / ");
  return [
    `Production issue from ${i.app} (${i.priority} ${PRIORITY_LABEL[i.priority]}), alerted ${new Date().toISOString()}.`,
    `Summary: ${i.summary}`,
    `Event: ${i.event} | Fingerprint: ${i.fingerprint} | Count: ${i.count} since ${i.firstSeen} | Release: ${i.release ?? "not recorded"}`,
    `Error: ${(i.message ?? "not recorded").slice(0, 300)}`,
    `Stack top: ${stackTop || "not recorded"}`,
    `Admin log: ${i.adminLogUrl ?? "not recorded"}`,
    "Investigate per the never-guess rule: reproduce locally first (never debug against production),",
    "find the root cause, fix it with a test, then /ship. If it is not a real issue, say why and log it.",
  ].join("\n");
}

export function sessionUrl(prompt: string, folder = process.env.ADMIN_EMAIL_SESSION_FOLDER): string {
  const tail = folder ? `&folder=${encodeURIComponent(folder)}` : "";
  const build = (t: string) => `claude://code/new?q=${encodeURIComponent(t)}${tail}`;
  if (build(prompt).length <= SESSION_URL_CAP) return build(prompt);
  const note = "\n[... cut to fit the link; open the admin log for the rest]";
  // Keep the Admin log line: it is how the session fetches the rest.
  const lines = prompt.split("\n");
  const logLine = lines.find((l) => l.startsWith("Admin log:")) ?? "";
  let body = lines.filter((l) => l !== logLine);
  let log = logLine;
  const join = () => [...body, log].filter(Boolean).join("\n") + note;
  // Cut by code points so a cut never leaves a lone surrogate (encodeURIComponent throws on one).
  const cut = (s: string) => Array.from(s).slice(0, -20).join("");
  while (body.length > 1 && build(join()).length > SESSION_URL_CAP) body.pop();
  while (body.length && body[body.length - 1] && build(join()).length > SESSION_URL_CAP) {
    body[body.length - 1] = cut(body[body.length - 1] ?? "");
  }
  // Only when the admin-log line alone is too long: cut it too (it can never loop forever).
  while (log && build(join()).length > SESSION_URL_CAP) log = cut(log);
  return build(join());
}

// ---------------------------------------------------------------- HTML parts
function button(url: string, label: string, primary = false): string {
  const [bg, fg, bd] = primary ? ["#0b57d0", "#ffffff", "#0b57d0"] : ["#ffffff", "#0b57d0", "#9db5e3"];
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="left" style="margin:8px 8px 0 0;"><tr><td bgcolor="${bg}" style="background:${bg};border:1px solid ${bd};border-radius:6px;padding:7px 14px;"><a href="${esc(url)}" style="color:${fg};font-family:${FONT};font-size:13px;font-weight:600;text-decoration:none;white-space:nowrap;">${esc(label)}</a></td></tr></table>`;
}
const clear = '<div style="clear:both;font-size:1px;line-height:1px;">&nbsp;</div>';

function rows(pairs: [string, unknown][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;font-size:13.5px;">` +
    pairs.map(([k, v]) => `<tr><td class="muted" style="padding:5px 10px 5px 0;color:${SUB};width:150px;vertical-align:top;border-bottom:1px solid #f0f1f3;">${esc(k)}</td><td class="ink" style="padding:5px 0;color:${INK};vertical-align:top;border-bottom:1px solid #f0f1f3;word-break:break-word;">${v === undefined || v === null || v === "" ? '<span style="color:#9aa0a6;">not recorded</span>' : esc(v)}</td></tr>`).join("") +
    "</table>";
}

function section(heading: string, body: string): string {
  if (!body) return "";
  return `<tr><td class="card" bgcolor="${CARD}" style="background:${CARD};border:1px solid ${LINE};border-radius:10px;padding:16px 20px;"><div class="sub" style="font-size:12.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${SUB};margin-bottom:8px;">${esc(heading)}</div>${body}</td></tr><tr><td style="height:12px;font-size:1px;line-height:1px;">&nbsp;</td></tr>`;
}

function page(title: string, bandColor: string, head: string, sub: string,
              sections: string, footer: string, banner = ""): string {
  const css = "body{margin:0;padding:0;}table{border-collapse:collapse;}a{text-decoration:none;}" +
    "code,pre{font-family:Consolas,Monaco,monospace;font-size:12px;}" +
    "@media (prefers-color-scheme: dark){.page{background:#1b1c1e !important;}" +
    ".card{background:#242629 !important;border-color:#3a3d41 !important;}" +
    ".ink{color:#e8eaed !important;}.muted,.sub{color:#a8acb1 !important;}" +
    ".pre{background:#2c3138 !important;color:#e8eaed !important;}}";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(title)}</title><style>${css}</style></head><body style="margin:0;padding:0;"><table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" bgcolor="${PAGE}" style="width:100%;background:${PAGE};"><tr><td align="center" style="padding:16px 8px;"><table role="presentation" width="720" cellpadding="0" cellspacing="0" style="width:100%;max-width:720px;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK};">` +
    (banner ? `<tr><td bgcolor="#fff4ce" style="background:#fff4ce;color:#5c4400;padding:10px 16px;border-radius:8px;font-size:13.5px;font-weight:600;">${esc(banner)}</td></tr><tr><td style="height:10px;font-size:1px;">&nbsp;</td></tr>` : "") +
    `<tr><td bgcolor="${bandColor}" style="background:${bandColor};padding:16px 20px;border-radius:10px;color:#ffffff;"><div style="font-size:20px;font-weight:700;color:#ffffff;">${esc(head)}</div><div style="font-size:14px;color:#ffffff;margin-top:4px;">${esc(sub)}</div></td></tr><tr><td style="height:12px;font-size:1px;line-height:1px;">&nbsp;</td></tr>` +
    sections +
    `<tr><td class="muted" align="center" style="color:${SUB};font-size:11.5px;padding:6px 0 18px 0;">${footer}</td></tr></table></td></tr></table></body></html>`;
}

function importanceLine(im: Importance = {}): string {
  return `Users affected: ${im.usersAffected ?? "unknown"} · Science output affected: ${im.scienceAffected ?? "unknown"} · Money/cost affected: ${im.moneyAffected ?? "unknown"} · Data at risk: ${im.dataAtRisk ?? "unknown"}`;
}

export function subjectFor(i: AdminIssue, prefix = ""): string {
  return `${prefix}[${i.priority} ${PRIORITY_LABEL[i.priority]}] ${i.app} · ${i.summary}`.slice(0, 180);
}

export function renderIssueAlert(i: AdminIssue, opts: { prefix?: string; folder?: string } = {}):
  { subject: string; html: string; text: string } {
  const prefix = opts.prefix ?? "";
  const url = sessionUrl(sessionPrompt(i), opts.folder ?? process.env.ADMIN_EMAIL_SESSION_FOLDER);
  const label = PRIORITY_LABEL[i.priority];
  const banner = prefix ? `${prefix.trim()} — no production user was affected by this event.` : "";
  const details: [string, unknown][] = [
    ["Event", i.event], ["Message", i.message], ["Error class", i.errorClass],
    ["Route / job", i.route], ["HTTP status", i.httpStatus], ["Request id", i.requestId],
    ["First seen", i.firstSeen], ["Last seen", i.lastSeen],
    ["Occurrences", i.countSinceLastAlert != null ? `${i.count} (${i.countSinceLastAlert} since last alert)` : i.count],
    ["Fingerprint", i.fingerprint], ["Environment", `${i.environment}${i.platform ? " · " + i.platform : ""}`],
    ["Release", i.release], ["User (hashed)", i.userRef], ["Source", i.source ?? "error log"],
  ];
  const stack = i.stack
    ? `<div class="pre" style="margin-top:10px;background:#f6f8fa;border:1px solid ${LINE};border-radius:6px;padding:10px;white-space:pre-wrap;font-family:Consolas,Monaco,monospace;font-size:12px;color:${INK};">${esc(i.stack.split("\n").slice(0, 12).join("\n"))}</div>`
    : `<div class="muted" style="margin-top:8px;color:${SUB};font-size:12.5px;">Stack trace: not recorded</div>`;
  const btns = button(url, "Start a Claude Code session on this issue", true) +
    (i.adminLogUrl ? button(i.adminLogUrl, "Open admin log") : "") +
    (i.platformLogUrl ? button(i.platformLogUrl, "Open platform logs") : "") + clear;
  const sections =
    section("What happened", `<div class="ink" style="color:${INK};">${esc(i.explanation)}</div>`) +
    section("Priority and importance", `<div class="ink" style="color:${COLOR[i.priority]};font-weight:700;">${i.priority} ${label}</div><div class="ink" style="color:${INK};font-size:13.5px;margin-top:4px;">${esc(importanceLine(i.importance))}</div>`) +
    section("Suggested first step", `<div class="ink" style="color:${INK};">${esc(i.suggestedStep ?? "Open the session below; it will reproduce the error locally first.")}</div>${btns}`) +
    section("Error details", rows(details) + stack);
  const footer = `${esc(i.app)} · ${esc(i.environment)} · admin email standard v${STANDARD_VERSION}<br>${i.priority} alert. This issue is muted for 24 h; further occurrences are counted and appear in the next alert or the fortnight digest.${(opts.folder ?? process.env.ADMIN_EMAIL_SESSION_FOLDER) ? "" : "<br>ADMIN_EMAIL_SESSION_FOLDER is not set, so the session button opens without a project folder."}`;
  const html = page(subjectFor(i, prefix), COLOR[i.priority], `${i.priority} ${label} · ${i.app}`, i.summary, sections, footer, banner);
  const text = [
    banner, subjectFor(i, prefix), "", "WHAT HAPPENED", i.explanation, "",
    "PRIORITY AND IMPORTANCE", `${i.priority} ${label}`, importanceLine(i.importance), "",
    "SUGGESTED FIRST STEP", i.suggestedStep ?? "Open the session link below.", "",
    "ERROR DETAILS", ...details.map(([k, v]) => `${k}: ${v ?? "not recorded"}`),
    "", "Stack:", (i.stack ?? "not recorded").split("\n").slice(0, 12).join("\n"), "",
    `Start a Claude Code session: ${url}`, i.adminLogUrl ? `Admin log: ${i.adminLogUrl}` : "",
  ].filter((l) => l !== undefined).join("\n");
  return { subject: subjectFor(i, prefix), html, text };
}

export function renderDigest(d: DigestInput, opts: { prefix?: string; folder?: string } = {}):
  { subject: string; html: string; text: string } {
  const prefix = opts.prefix ?? "";
  const folder = opts.folder ?? process.env.ADMIN_EMAIL_SESSION_FOLDER;
  const order: Priority[] = ["P1", "P2", "P3", "P4"];
  const open = [...d.open].sort((a, b) => order.indexOf(a.priority) - order.indexOf(b.priority));
  const p1 = open.filter((i) => i.priority === "P1").length;
  const p2 = open.filter((i) => i.priority === "P2").length;
  const worst = open[0]?.priority;
  const verdict = !open.length ? "all quiet" : (p1 || p2) ? "action required" : "needs attention";
  const fmt = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Vienna" });
  const subject = `${prefix}[${d.app}] Fortnight digest ${fmt(d.periodStart)}–${fmt(d.periodEnd)}: ${open.length} open issue${open.length === 1 ? "" : "s"} (${p1} P1, ${p2} P2) · ${verdict}`;
  const cards = open.map((i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 10px 0;border:1px solid ${LINE};"><tr><td width="5" bgcolor="${COLOR[i.priority]}" style="background:${COLOR[i.priority]};width:5px;padding:0;font-size:1px;">&nbsp;</td><td class="card" bgcolor="${CARD}" style="background:${CARD};padding:10px 14px;"><span style="color:${COLOR[i.priority]};font-weight:700;font-size:12px;">${i.priority} ${PRIORITY_LABEL[i.priority]}</span><div class="ink" style="color:${INK};font-size:14.5px;">${esc(i.summary)}</div><div class="muted" style="color:${SUB};font-size:12.5px;">${esc(i.event)} · ${i.count}× · first ${esc(i.firstSeen)} · last ${esc(i.lastSeen)} · ${esc(i.fingerprint)}</div>${button(sessionUrl(sessionPrompt(i), folder), "Start a session on this issue", true)}${clear}</td></tr></table>`).join("");
  const wholePrompt = `Fortnight admin digest for ${d.app}, ${d.periodStart} to ${d.periodEnd}: ${open.length} open issues (${p1} P1, ${p2} P2).\n` +
    open.slice(0, 15).map((i) => `- ${i.priority} ${i.summary} [${i.fingerprint}] ${i.count}x`).join("\n") +
    `\nAdmin: ${d.adminUrl ?? "not recorded"}\nTriage these per the never-guess rule; reproduce locally, fix or log each to TODO.md with debt.py.`;
  const nums = d.numbers.map((n) => `<table role="presentation" cellpadding="0" cellspacing="0" align="left" style="margin:0 24px 10px 0;"><tr><td><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:${SUB};">${esc(n.label)}</div><div class="ink" style="font-size:22px;font-weight:600;color:${INK};">${esc(n.value)}</div></td></tr></table>`).join("") + clear;
  const sections =
    section("Headline numbers", nums) +
    section(`Still open (${open.length})`, cards || `<div class="ink" style="color:${COLOR.OK};">No open issues. The alerting is alive — this digest is its proof.</div>`) +
    section(`Resolved this fortnight (${d.resolved.length})`, d.resolved.length ? `<ul style="margin:0;padding-left:18px;">${d.resolved.map((r) => `<li class="ink" style="color:${INK};">${esc(r.summary)} <span class="muted" style="color:${SUB};font-size:12px;">${esc(r.fingerprint)} · ${esc(r.resolvedAt)}</span></li>`).join("")}</ul>` : "") +
    section("Low-priority noise (P4)", d.noise.length ? rows(d.noise.slice(0, 15).map((n) => [n.event, `${n.count}×`])) : "") +
    section("Health of the alerting itself", rows(d.alertingHealth.map((h) => [h.label, h.value]))) +
    section("Act on this digest", button(sessionUrl(wholePrompt, folder), "Start a session on this whole digest", true) + (d.adminUrl ? button(d.adminUrl, "Open admin") : "") + clear);
  const band = worst ? COLOR[worst] : COLOR.OK;
  const html = page(subject, band, `${d.app} · fortnight digest`, `${fmt(d.periodStart)}–${fmt(d.periodEnd)} · ${verdict}`, sections,
    `${esc(d.app)} · ${esc(d.environment)} · admin email standard v${STANDARD_VERSION}<br>Sent on the 1st and 15th of each month. Issues are emailed as they happen; this digest covers everything else.`,
    prefix ? `${prefix.trim()} — not a production digest.` : "");
  const text = [subject, "", "HEADLINE NUMBERS", ...d.numbers.map((n) => `${n.label}: ${n.value}`), "",
    `STILL OPEN (${open.length})`, ...open.map((i) => `${i.priority} ${PRIORITY_LABEL[i.priority]} ${i.summary} [${i.fingerprint}] ${i.count}x`),
    "", `RESOLVED (${d.resolved.length})`, ...d.resolved.map((r) => `${r.summary} [${r.fingerprint}]`),
    "", "LOW-PRIORITY NOISE", ...d.noise.slice(0, 15).map((n) => `${n.event}: ${n.count}x`),
    "", "ALERTING HEALTH", ...d.alertingHealth.map((h) => `${h.label}: ${h.value}`),
    "", `Start a session on this digest: ${sessionUrl(wholePrompt, folder)}`].join("\n");
  return { subject, html, text };
}
