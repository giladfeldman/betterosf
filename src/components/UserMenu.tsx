import Link from "next/link";
import type { Route } from "next";
import { auth, signOut } from "@/auth";
import { SignInButton } from "./SignInButton";
import { isAdminSession } from "@/lib/admin";

export async function UserMenu() {
  const session = await auth();
  if (!session) {
    return <SignInButton />;
  }
  const admin = await isAdminSession();
  const statusText = session.osfAuthError ? "Reconnect needed" : session.osfCanWrite ? "Uploads enabled" : "Read-only";
  const statusClass = session.osfAuthError
    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
    : session.osfCanWrite
    ? "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
    : "border-neutral-300 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300";
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={`rounded border px-2 py-1 text-xs ${statusClass}`}>{statusText}</span>
      {session.osfAuthError && (
        <SignInButton
          forceApproval
          className="border rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Reconnect OSF
        </SignInButton>
      )}
      <Link href={"/me" as Route} className="hover:underline">
        Dashboard
      </Link>
      {/* Signed-in-only shortcut: previously users had to know the
          ?scope=user:me query string to search their own projects. */}
      <Link href={"/search?scope=user:me" as Route} className="hover:underline">
        My projects
      </Link>
      {admin && (
        <>
          <Link href={"/admin/logs" as Route} className="hover:underline">
            Logs
          </Link>
          <Link href={"/admin/feedback" as Route} className="hover:underline">
            Feedback
          </Link>
        </>
      )}
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button type="submit" className="border rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          Sign out
        </button>
      </form>
    </div>
  );
}
