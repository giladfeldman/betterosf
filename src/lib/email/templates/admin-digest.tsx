import * as React from "react";
import { EmailLayout } from "@/lib/email/templates/layout";
import type { AdminDigest } from "@/lib/notifications/admin-digest";

export function AdminDigestEmail({
  appName,
  appUrl,
  digest,
  banner = null,
}: {
  appName: string;
  appUrl: string;
  digest: AdminDigest;
  /** Non-production digests open with this (d-bf671b); null for production. */
  banner?: string | null;
}): React.ReactElement {
  const logsUrl = appUrl ? `${appUrl.replace(/\/$/, "")}/admin/logs?level=error` : "";
  return (
    <EmailLayout>
      {banner && (
        <p>
          <strong>{banner}</strong>
        </p>
      )}
      <h2>{appName} — error digest</h2>
      <p>
        In the last {digest.windowHours}h: <strong>{digest.errorCount}</strong>{" "}
        error{digest.errorCount === 1 ? "" : "s"}, <strong>{digest.warnCount}</strong>{" "}
        warning{digest.warnCount === 1 ? "" : "s"}.
      </p>
      {digest.nonProductionExcluded > 0 && (
        <p>
          Not counted: {digest.nonProductionExcluded} event{digest.nonProductionExcluded === 1 ? "" : "s"} from
          local or preview servers (recorded in the logs, not production).
        </p>
      )}

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
