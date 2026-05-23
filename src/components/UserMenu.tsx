import { auth, signOut } from "@/auth";
import { SignInButton } from "./SignInButton";

export async function UserMenu() {
  const session = await auth();
  if (!session) {
    return <SignInButton />;
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <a href="/me" className="hover:underline">Dashboard</a>
      <form action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}>
        <button type="submit" className="border rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          Sign out
        </button>
      </form>
    </div>
  );
}
