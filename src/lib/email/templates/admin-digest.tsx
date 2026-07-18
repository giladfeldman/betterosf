import * as React from "react";
import { EmailLayout } from "@/lib/email/templates/layout";
import type { AdminDigest } from "@/lib/notifications/admin-digest";

export function AdminDigestEmail({
  appName,
  appUrl,
  digest,
}: {
  appName: string;
  appUrl: string;
  digest: AdminDigest;
}): React.ReactElement {
  const logsUrl = appUrl ? `${appUrl.replace(/\/$/, "")}/admin/logs?level=error` : "";
  return (
    <EmailLayout>
      <h2>{appName} — error digest</h2>
      <p>
        In the last {digest.windowHours}h: <strong>{digest.errorCount}</strong>{" "}
        error{digest.errorCount === 1 ? "" : "s"}, <strong>{digest.warnCount}</strong>{" "}
        warning{digest.warnCount === 1 ? "" : "s"}.
      </p>

      {digest.groups.length > 0 && (
        <>
          <h3>Top events</h3>
          <ul>
            {digest.groups.slice(0, 15).map((g) => (
              <li key={g.event}>
                <strong>{g.count}×</strong> <code>{g.event}</code> — last {g.lastSeen}
                {g.sampleMeta ? (
                  <div style={{ color: "#666", fontSize: "12px" }}>
                    {JSON.stringify(g.sampleMeta).slice(0, 300)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {digest.recent.length > 0 && (
        <>
          <h3>Most recent</h3>
          <ul>
            {digest.recent.map((r, i) => (
              <li key={i} style={{ fontSize: "12px" }}>
                [{r.level}] <code>{r.event}</code> — {r.createdAt}
              </li>
            ))}
          </ul>
        </>
      )}

      {logsUrl ? (
        <p>
          <a href={logsUrl}>Open the admin log viewer →</a>
        </p>
      ) : null}
    </EmailLayout>
  );
}
