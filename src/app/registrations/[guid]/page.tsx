import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getRegistration } from "@/lib/osf/registrations";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";

export async function generateMetadata({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) return { title: "BetterOSF" };
  try {
    const reg = await getRegistration(guid);
    return {
      title: `${reg.title} — BetterOSF`,
      description: reg.description.slice(0, 200),
    };
  } catch {
    return { title: "BetterOSF" };
  }
}

function renderValue(v: string | string[] | number | boolean | null): React.ReactNode {
  if (v === null || v === undefined) return <span className="text-neutral-500">—</span>;
  if (Array.isArray(v)) return <ul className="list-disc list-inside">{v.map((x, i) => <li key={i}>{String(x)}</li>)}</ul>;
  if (typeof v === "string" && v.length > 200) return <p className="whitespace-pre-wrap">{v}</p>;
  return <span>{String(v)}</span>;
}

export default async function RegistrationPage({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  if (!isValidGuid(guid)) notFound();

  let reg;
  try {
    reg = await getRegistration(guid);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

  const responseKeys = Object.keys(reg.responses);

  return (
    <article className="max-w-4xl">
      <Breadcrumb
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Registrations", href: "/search?type=registrations&q=" },
          { label: reg.title || guid, href: `/registrations/${guid}` },
        ]}
      />
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">{reg.title}</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Registered {reg.dateRegistered.slice(0, 10)} · {reg.public ? "Public" : "Private"} ·{" "}
          <a href={reg.osfUrl} className="text-blue-600 hover:underline">View on OSF</a>
        </p>
        {reg.registeredFromNodeId && (
          <p className="text-sm mt-1">
            Registered from project{" "}
            <a href={`/${reg.registeredFromNodeId}`} className="text-blue-600 hover:underline">{reg.registeredFromNodeId}</a>
          </p>
        )}
      </header>

      {reg.description && (
        <section className="mb-6">
          <h2 className="text-xl font-semibold mb-2">Description</h2>
          <p className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{reg.description}</p>
        </section>
      )}

      <section>
        <h2 className="text-xl font-semibold mb-2">Schema responses ({responseKeys.length})</h2>
        {responseKeys.length === 0 ? (
          <p className="text-neutral-500">No schema responses recorded.</p>
        ) : (
          <dl className="space-y-3">
            {responseKeys.map((k) => (
              <div key={k} className="border-l-2 border-neutral-300 dark:border-neutral-700 pl-3">
                <dt className="text-sm font-mono text-neutral-600 dark:text-neutral-400">{k}</dt>
                <dd className="mt-1">{renderValue(reg.responses[k] ?? null)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </article>
  );
}
