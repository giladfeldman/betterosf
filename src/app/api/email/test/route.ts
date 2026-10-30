import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { sendEmail, renderEmail } from "@/lib/email";
import { EmailLayout } from "@/lib/email/templates/layout";
import * as React from "react";
import { alertEmailPolicy, deploymentEnvironment } from "@/lib/alert-env";

/** The operator's own configured addresses; nobody else can be targeted from this route. */
const allowedRecipients = () =>
  new Set(
    [process.env.ADMIN_NOTIFY_EMAIL, process.env.NEXT_PUBLIC_ADMIN_EMAIL]
      .map((e) => (e ?? "").trim().toLowerCase())
      .filter(Boolean),
  );

/** Admin-only test send — allowlisted recipients only. */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let to = "";
  try {
    const body = (await req.json()) as { to?: string };
    to = (body.to ?? process.env.ADMIN_NOTIFY_EMAIL ?? process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "")
      .trim()
      .toLowerCase();
  } catch {
    to = (process.env.ADMIN_NOTIFY_EMAIL ?? process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "")
      .trim()
      .toLowerCase();
  }

  if (!to || (!allowedRecipients().has(to) && !to.endsWith("@simulator.amazonses.com"))) {
    return NextResponse.json({ error: "recipient_not_allowlisted" }, { status: 400 });
  }

  const { html, text } = await renderEmail(
    React.createElement(
      EmailLayout,
      null,
      React.createElement("h2", null, "BetterOSF SES test"),
      React.createElement("p", null, "If you received this, SES + betterosf@scimeto.app is working."),
    ),
  );

  const result = await sendEmail({
    to,
    // An explicit admin test, so it is always sent — but from a non-production server the
    // subject says so (d-bf671b): it must never read as a live-site message.
    subject: alertEmailPolicy(deploymentEnvironment(), { optIn: true }).subject("[BetterOSF] SES test"),
    html,
    text,
    idempotencyKey: `ses-test-${to}-${new Date().toISOString().slice(0, 13)}`,
  });

  return NextResponse.json({ ok: result.sent, result });
}
