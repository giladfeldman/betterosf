"use client";

export default function ProjectError({ error, reset }: { error: Error; reset: () => void }) {
  const lowerMessage = error.message.toLowerCase();
  const isAuth = lowerMessage.includes("authentication required") || lowerMessage.includes("unauthorized") || lowerMessage.includes("session expired");
  const isForbidden = lowerMessage.includes("forbidden") || lowerMessage.includes("permission denied");
  const isRateLimited = lowerMessage.includes("rate_limited") || lowerMessage.includes("rate limit");
  const isUpstream = lowerMessage.includes("upstream") || lowerMessage.includes("timeout") || lowerMessage.includes("fetch failed");
  const msg = isAuth
    ? "Your OSF connection expired. Reconnect OSF, then retry this project."
    : isForbidden
    ? "OSF denied access to this project or component. Sign in with an account that has permission, or open the public OSF page."
    : isRateLimited
    ? "OSF asked BetterOSF to slow down. Wait a minute, then retry."
    : isUpstream
    ? "OSF did not respond cleanly. Retry, or open the project on OSF while BetterOSF recovers."
    : "BetterOSF could not finish loading this project. Retry, and reconnect OSF if this page was open for a while.";
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-2">Couldn&apos;t load this project</h1>
      <p className="text-neutral-600 mb-4">{msg}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={reset} className="border px-3 py-1 rounded">Retry</button>
        {(isAuth || isForbidden) && <a href="/login" className="border px-3 py-1 rounded hover:bg-neutral-50 dark:hover:bg-neutral-900">Sign in / reconnect</a>}
      </div>
    </div>
  );
}
