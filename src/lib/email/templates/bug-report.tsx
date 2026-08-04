import * as React from "react";
import { EmailLayout } from "@/lib/email/templates/layout";

export type BugReportEmailData = {
  id: string;
  kind: string;
  message: string;
  contactEmail: string | null;
  pageUrl: string | null;
  appVersion: string;
  osfUserId: string | null;
  userAgent: string | null;
  createdAt: string;
};

/**
 * Admin notification for a newly-submitted bug report.
 *
 * All user-supplied values pass through `renderEmail`'s escaping walker, so the
 * message body is inserted as TEXT — a report containing HTML or a script tag
 * renders as literal characters rather than markup.
 */
export function BugReportEmail({
  appName,
  appUrl,
  report,
}: {
  appName: string;
  appUrl: string;
  report: BugReportEmailData;
}): React.ReactElement {
  const base = appUrl.replace(/\/$/, "");
  const adminUrl = base ? `${base}/admin/feedback` : "";
  const label = report.kind === "idea" ? "Idea" : report.kind === "question" ? "Question" : "Bug report";

  return (
    <EmailLayout>
      <h2>
        {appName} — new {label.toLowerCase()}
      </h2>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "6px",
          padding: "12px 14px",
          margin: "12px 0",
          background: "#fafafa",
          whiteSpace: "pre-wrap",
        }}
      >
        {report.message}
      </div>

      <h3>Details</h3>
      <ul>
        <li>
          <strong>Type:</strong> {label}
        </li>
        <li>
          <strong>Version:</strong> {report.appVersion}
        </li>
        <li>
          <strong>Page:</strong> {report.pageUrl ?? "(not supplied)"}
        </li>
        <li>
          <strong>Reply to:</strong> {report.contactEmail ?? "(none given — reporter is anonymous)"}
        </li>
        <li>
          <strong>OSF user:</strong> {report.osfUserId ?? "(signed out)"}
        </li>
        <li>
          <strong>Submitted:</strong> {report.createdAt}
        </li>
        {report.userAgent ? (
          <li style={{ color: "#666", fontSize: "12px" }}>
            <strong>User agent:</strong> {report.userAgent}
          </li>
        ) : null}
      </ul>

      {adminUrl ? (
        <p>
          <a href={adminUrl}>Open the feedback inbox</a>
        </p>
      ) : null}

      <p style={{ color: "#666", fontSize: "12px" }}>Report id: {report.id}</p>
    </EmailLayout>
  );
}
