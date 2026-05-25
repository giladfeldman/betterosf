import { notFound } from "next/navigation";
import { isValidGuid } from "@/lib/osf/guid";
import { getRegistration, type RegistrationDetailView } from "@/lib/osf/registrations";
import { OsfError } from "@/lib/osf/types";
import { Breadcrumb } from "@/components/Breadcrumb";

export const metadata = { title: "Compare registrations — BetterOSF" };

function renderValue(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.map(String).join(", ");
  return String(v);
}

function diffRow(key: string, a: unknown, b: unknown) {
  const sa = renderValue(a);
  const sb = renderValue(b);
  const same = sa === sb;
  return (
    <tr key={key} className={same ? "" : "bg-amber-50 dark:bg-amber-950"}>
      <td className="font-mono text-xs px-3 py-2 border align-top w-1/4">{key}</td>
      <td className="px-3 py-2 border align-top whitespace-pre-wrap">{sa}</td>
      <td className="px-3 py-2 border align-top whitespace-pre-wrap">{sb}</td>
    </tr>
  );
}

export default async function CompareRegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const sp = await searchParams;
  const a = sp.a ?? "";
  const b = sp.b ?? "";
  if (!isValidGuid(a) || !isValidGuid(b)) notFound();

  let regA: RegistrationDetailView, regB: RegistrationDetailView;
  try {
    [regA, regB] = await Promise.all([getRegistration(a), getRegistration(b)]);
  } catch (e) {
    if (e instanceof OsfError && e.code === "not_found") notFound();
    throw e;
  }

  const keys = Array.from(
    new Set([...Object.keys(regA.responses), ...Object.keys(regB.responses)]),
  ).sort();

  return (
    <article className="max-w-6xl">
      <Breadcrumb
        crumbs={[
          { label: "Home", href: "/" },
          { label: "Registrations", href: "/search?type=registrations&q=" },
          { label: "Compare", href: `/registrations/compare?a=${a}&b=${b}` },
        ]}
      />
      <h1 className="text-2xl font-semibold mb-4">Compare registrations</h1>
      <p className="text-sm text-neutral-600 mb-4">
        Differences highlighted in{" "}
        <span className="bg-amber-50 dark:bg-amber-950 px-1">amber</span>.
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-neutral-100 dark:bg-neutral-800">
            <th className="px-3 py-2 border text-left">Response</th>
            <th className="px-3 py-2 border text-left">
              <a href={`/registrations/${regA.id}`} className="text-blue-600 hover:underline">
                {regA.title || regA.id}
              </a>
              <span className="block text-xs text-neutral-500">
                {regA.dateRegistered.slice(0, 10)}
              </span>
            </th>
            <th className="px-3 py-2 border text-left">
              <a href={`/registrations/${regB.id}`} className="text-blue-600 hover:underline">
                {regB.title || regB.id}
              </a>
              <span className="block text-xs text-neutral-500">
                {regB.dateRegistered.slice(0, 10)}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>{keys.map((k) => diffRow(k, regA.responses[k], regB.responses[k]))}</tbody>
      </table>
    </article>
  );
}
