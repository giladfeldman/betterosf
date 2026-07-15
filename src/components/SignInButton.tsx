"use client";

import type { ReactNode } from "react";
import { signIn } from "next-auth/react";

/**
 * @param forceApproval — when true, pass approval_prompt=force so OSF re-consents
 *   and issues a refresh token (needed when reconnecting after a prior online-only grant).
 */
export function SignInButton({
  className,
  children = "Sign in with OSF",
  forceApproval = false,
}: {
  className?: string;
  children?: ReactNode;
  forceApproval?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        signIn(
          "osf",
          { callbackUrl: "/me" },
          forceApproval ? { approval_prompt: "force" } : undefined
        )
      }
      className={className ?? "border rounded px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700"}
    >
      {children}
    </button>
  );
}
