"use client";

import { signIn } from "next-auth/react";

export function SignInButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => signIn("osf", { callbackUrl: "/me" })}
      className={className ?? "border rounded px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700"}
    >
      Sign in with OSF
    </button>
  );
}
