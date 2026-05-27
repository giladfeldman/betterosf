import { BetterOsfLogo } from "@/components/BetterOsfLogo";

export const metadata = { title: "Information - BetterOSF" };

const links = [
  {
    title: "Scirenity",
    href: "https://scirenity.com",
    description: "The broader platform for focused research tools.",
  },
  {
    title: "SciMeto",
    href: "https://scimeto.app",
    description: "A related Scirenity app for manuscript and research-integrity workflows.",
  },
  {
    title: "ESCI Mate",
    href: "https://escimate.app",
    description: "A related Scirenity app for effect-size and evidence-synthesis workflows.",
  },
  {
    title: "OSF",
    href: "https://osf.io",
    description: "The Open Science Framework. BetterOSF displays OSF-hosted data.",
  },
  {
    title: "GitHub",
    href: "https://github.com/giladfeldman/betterosf",
    description: "Source code, issues, and contribution history.",
  },
];

export default function InformationPage() {
  return (
    <article className="max-w-5xl">
      <header className="mb-8 border-b border-neutral-200 pb-6 dark:border-neutral-800">
        <BetterOsfLogo variant="full" className="mb-4" />
        <h1 className="text-2xl font-semibold">Information and links</h1>
        <p className="mt-2 max-w-2xl text-neutral-700 dark:text-neutral-300">
          BetterOSF is part of Scirenity: a family of research tools built around speed, transparency,
          and researcher-friendly workflows.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="block rounded border border-neutral-200 p-4 hover:border-blue-400 hover:bg-blue-50/40 dark:border-neutral-800 dark:hover:border-blue-500 dark:hover:bg-blue-950/20"
          >
            <h2 className="text-lg font-semibold text-blue-600">{link.title}</h2>
            <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{link.description}</p>
          </a>
        ))}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-3 text-neutral-700 dark:text-neutral-300">
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">What BetterOSF is for</h2>
          <p>
            BetterOSF is for quickly opening public OSF projects, scanning their files, previewing common
            research formats, and downloading exactly the project, folder, or selected files you need.
          </p>
          <p>
            It does not replace OSF as a repository. It is a faster interface layered on top of OSF data.
          </p>
        </div>
        <aside className="rounded border border-neutral-200 p-4 text-sm dark:border-neutral-800">
          <h2 className="font-semibold">Legal</h2>
          <ul className="mt-2 space-y-2 text-blue-600">
            <li><a className="hover:underline" href="/about">About BetterOSF</a></li>
            <li><a className="hover:underline" href="/privacy">Privacy</a></li>
            <li><a className="hover:underline" href="https://github.com/giladfeldman/betterosf">Open source</a></li>
          </ul>
        </aside>
      </section>
    </article>
  );
}
