import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { systemLogs } from "@/lib/db/schema";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogType =
  | "request"
  | "auth"
  | "osf"
  | "upload"
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
    await db.insert(systemLogs).values({
      level,
      type,
      message: truncateMessage(message),
      context: truncateContext(redactContext(context)),
      userId: userId ?? null,
    });
    void maybeCleanup();
  } catch (err) {
    console.error("[logger]", err);
  }
}

export function logInfo(type: LogType, message: string, context?: Record<string, unknown>, userId?: string | null): void {
  void writeLog("info", type, message, context, userId);
}

export function logWarn(type: LogType, message: string, context?: Record<string, unknown>, userId?: string | null): void {
  void writeLog("warn", type, message, context, userId);
}

export function logError(type: LogType, message: string, context?: Record<string, unknown>, userId?: string | null): void {
  void writeLog("error", type, message, context, userId);
}
