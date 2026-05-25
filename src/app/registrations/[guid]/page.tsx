import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getRegistration } from "@/lib/osf/registrations";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";
import { PinButton } from "@/components/PinButton";
import { RecordView } from "@/components/RecordView";
import { renderValue } from "@/lib/registrations/render-value";

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
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
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
        </div>
        <PinButton refEntry={{ id: guid, title: reg.title || guid, kind: "registration" }} />
      </header>
      <RecordView refEntry={{ id: guid, title: reg.title || guid, kind: "registration" }} />

      <form action="/registrations/compare" method="get" className="mb-4 flex flex-wrap gap-2 items-center text-sm">
        <input type="hidden" name="a" value={guid} />
        <label className="flex items-center gap-2">
          Compare with:
          <input
            name="b"
            placeholder="another registration guid"
            className="border rounded px-2 py-1 font-mono text-xs"
            required
          />
        </label>
        <button
          type="submit"
          className="border rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Compare
        </button>
      </form>

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
