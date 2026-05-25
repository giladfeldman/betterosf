import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCurrentUser, getMyProjects } from "@/lib/osf/users";
import { OsfError } from "@/lib/osf/types";

export const metadata = { title: "My Dashboard — BetterOSF" };

export default async function MyDashboard() {
  const session = await auth();
  if (!session) redirect("/login");

  let user, projects;
  try {
    [user, projects] = await Promise.all([getCurrentUser(), getMyProjects()]);
  } catch (e) {
    if (e instanceof OsfError && e.code === "forbidden") {
      return (
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold mb-2">Session expired</h1>
          <p className="mb-4">Your OSF session has expired. Please sign in again.</p>
          <a href="/login" className="underline text-blue-600">Sign in</a>
        </div>
      );
    }
    throw e;
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-semibold mb-4">Hi, {user.fullName}</h1>
      <p className="mb-6 text-neutral-600">
        Signed in as <a href={user.osfUrl} className="underline text-blue-600">OSF user {user.id}</a>.
      </p>

      <p className="mb-4 text-sm">
        <a href="/search?scope=user:me" className="text-blue-600 hover:underline">Search my projects</a>
      </p>

      <h2 className="text-xl font-semibold mb-2">Your projects ({projects.length})</h2>
      <ul className="space-y-1">
        {projects.map((p) => (
          <li key={p.id}>
            <a href={`/${p.id}`} className="text-blue-600 hover:underline">{p.title || p.id}</a>
            {!p.public && <span className="ml-2 text-xs text-neutral-500">[private]</span>}
          </li>
        ))}
        {projects.length === 0 && <li className="text-neutral-500">No projects yet.</li>}
      </ul>
    </div>
  );
}
