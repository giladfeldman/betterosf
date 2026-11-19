import "server-only";

import { sql } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { systemLogs } from "@/lib/db/schema";
import { environmentLabel } from "@/lib/notifications/admin-email";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogType =
  | "request"
  | "auth"
  | "osf"
  | "upload"
  | "delete"
  | "rename"
  | "move"
  /** OSF Transition Toolkit: consent, inventory crawls, export and deposit runs. */
  | "transition"
  /** SES/SNS delivery feedback — bounces, complaints, and shapes we could not read. */
  | "email"
  | "db"
  | "admin"
  | "uncaught"
  | "other";

const MAX_CONTEXT_BYTES = 4096;
const MAX_MESSAGE_LEN = 1000;
const RETENTION_DAYS = 14;
const CLEANUP_PROBABILITY = 1 / 500;

const DROP_KEYS = new Set(
  ["password", "token", "authorization", "secret", "api_key", "auth_secret", "access_token", "refresh_token"].map(
    (k) => k.toLowerCase(),
  ),
);

function redactContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!context) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (DROP_KEYS.has(k.toLowerCase())) continue;
    if (k.toLowerCase() === "email" && typeof v === "string") {
      out.email = `***@${v.slice(-4)}`;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function truncateContext(context: Record<string, unknown>): Record<string, unknown> {
  try {
    const json = JSON.stringify(context);
    if (json.length <= MAX_CONTEXT_BYTES) return context;
    return { _truncated: true, _originalSize: json.length, _keys: Object.keys(context).slice(0, 20) };
  } catch {
    return { _serializationFailed: true };
  }
}

function truncateMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_LEN) return message;
  return message.slice(0, MAX_MESSAGE_LEN) + "…";
}

export function errorDetails(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { errorName: err.name, errorMessage: err.message, errorStack: err.stack?.slice(0, 2000) };
  }
  return { errorMessage: String(err) };
}

async function maybeCleanup(): Promise<void> {
  if (Math.random() > CLEANUP_PROBABILITY) return;
  const db = getDb();
  if (!db) return;
  try {
    await db.execute(
      sql`DELETE FROM system_logs WHERE created_at < NOW() - (${RETENTION_DAYS}::int * INTERVAL '1 day')`,
    );
  } catch {
    /* best-effort */
  }
}

async function writeLog(
  level: LogLevel,
  type: LogType,
  message: string,
  context?: Record<string, unknown>,
  userId?: string | null,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    const row = {
      level,
      type,
      message: truncateMessage(message),
      // `_env` records where the event HAPPENED (d-bf671b). Local dev shares this table, and
      // the admin digest emails only production events — it can tell them apart only by this.
      context: { ...truncateContext(redactContext(context)), _env: environmentLabel() },
      userId: userId ?? null,
    };
    await db.insert(systemLogs).values(row);
    // Admin email standard: an error row may raise an issue alert (deduped, production only).
    // Dynamic import avoids a cycle and keeps the SES client out of non-error paths.
    // Awaited here, so the caller's keepAlive() covers it (d-3fd24d): a floating promise
    // can be frozen with the function the moment the response is sent, and the alert email
    // for the error that most needs one never leaves.
    if (level === "error") {
      await import("./notifications/admin-alert").then((m) =>
        m.maybeAlert({
          level,
          event: type,
          message,
          context: { ...row.context, stack: (context ?? {}).errorStack, route: (context ?? {}).route ?? (context ?? {}).path },
        }),
      ).catch((err) => console.error("[logger] admin alert failed", err));
    }
    void maybeCleanup();
  } catch (err) {
    console.error("[logger]", err);
  }
}

/**
 * Run a log write without blocking the caller, but keep the serverless function alive
 * until it finishes (d-3fd24d). Vercel may freeze a function as soon as its response is
 * sent; `after()` (Next 15) registers the promise with the platform's waitUntil so the row
 * and any admin alert email still complete. Outside a request (scripts, tests, build)
 * `after()` throws, and the promise simply runs as before.
 */
export function keepAlive(work: Promise<unknown>): void {
  try {
    after(work);
  } catch {
    void work;
  }
}

export function logInfo(type: LogType, message: string, context?: Record<string, unknown>, userId?: string | null): void {
  keepAlive(writeLog("info", type, message, context, userId));
}

export function logWarn(type: LogType, message: string, context?: Record<string, unknown>, userId?: string | null): void {
  keepAlive(writeLog("warn", type, message, context, userId));
}

export function logError(type: LogType, message: string, context?: Record<string, unknown>, userId?: string | null): void {
  keepAlive(writeLog("error", type, message, context, userId));
}

/**
 * Awaitable log write, for records that must be durable BEFORE the next action runs.
 *
 * The fire-and-forget helpers above are right for ordinary telemetry, but a consent
 * record for an irreversible deletion must land first: if the batch dies midway, the
 * evidence that the user agreed has to already exist. Returns true when the row was
 * written, false when no database is configured.
 */
export async function logEventAwaited(
  level: LogLevel,
  type: LogType,
  message: string,
  context?: Record<string, unknown>,
  userId?: string | null,
): Promise<boolean> {
  if (!getDb()) return false;
  await writeLog(level, type, message, context, userId);
  return true;
}
