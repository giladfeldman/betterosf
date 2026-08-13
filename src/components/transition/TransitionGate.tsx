"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { TransitionClickwrap } from "./TransitionClickwrap";
import { OSF_READ_SCOPE } from "@/lib/auth/osf-provider";
import { readApiError, networkError, type ApiError } from "@/lib/api-error";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Working } from "@/components/Progress";

type ConsentState =
  | { phase: "loading" }
  | { phase: "signed-out" }
  | { phase: "needs-consent" }
  | { phase: "ready" }
  | { phase: "error"; error: ApiError };

/**
 * Decides what the transition page shows: sign-in, the clickwrap, or the tool.
 *
 * Deliberately starts in `loading` and never in `ready`. Rendering the tool first and
 * hiding it once the check comes back would flash an ungated UI — and, more importantly,
 * would mean the client decided access. The server re-checks on every API call regardless
 * (see requireTransitionActor); this is the affordance, not the control.
 */
export function TransitionGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConsentState>({ phase: "loading" });

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/transition/consent", { cache: "no-store" });
      if (!res.ok) {
        setState({ phase: "error", error: await readApiError(res, "/api/transition/consent") });
        return;
      }
      const data: { signedIn: boolean; consented: boolean } = await res.json();
      if (!data.signedIn) setState({ phase: "signed-out" });
      else if (!data.consented) setState({ phase: "needs-consent" });
      else setState({ phase: "ready" });
    } catch (e) {
      setState({ phase: "error", error: networkError("/api/transition/consent", e) });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (state.phase === "loading") {
    return <Working>Checking your account…</Working>;
  }

  if (state.phase === "error") {
    return (
      <ErrorNotice
        error={state.error}
        title="Could not check your account"
        onRetry={() => void check()}
      />
    );
  }

  if (state.phase === "signed-out") {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">Sign in to prepare for the OSF transition</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          BetterOSF needs access to your OSF account to list your projects and read their contents.
        </p>
        {/*
          READ scope only, deliberately. Exporting and transferring never write to OSF, so
          asking for write here would be over-permissioned — and would sit badly next to the
          term promising this feature deletes nothing. Features that genuinely write (upload,
          rename, delete) request the wider scope at their own point of use.
        */}
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          This asks for <strong>read-only</strong> access. BetterOSF cannot change or delete
          anything on OSF with it.
        </p>
        <button
          type="button"
          onClick={() => void signIn("osf", { callbackUrl: "/transition" }, { scope: OSF_READ_SCOPE })}
          className="mt-6 rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Sign in with OSF
        </button>
      </div>
    );
  }

  if (state.phase === "needs-consent") {
    return <TransitionClickwrap onConsented={() => setState({ phase: "ready" })} />;
  }

  return <>{children}</>;
}
