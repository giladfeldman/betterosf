"use client";

import { useState } from "react";
import Link from "next/link";
import {
  suggestDestination,
  type ContentKind,
  type DataKind,
  type Destination,
  type Style,
} from "@/lib/transition/destination-guide";

/**
 * "Where should this project go?" — three questions from Lakens' repository comparison,
 * one suggested destination, and the steps to get there. Zenodo is the only destination
 * BetterOSF uploads to; for the rest it gives the verified export ZIP and instructions.
 */
export function DestinationGuide() {
  const [data, setData] = useState<DataKind | null>(null);
  const [content, setContent] = useState<ContentKind | null>(null);
  const [style, setStyle] = useState<Style | null>(null);
  const done = data !== null && content !== null && style !== null;
  const s = done ? suggestDestination({ data, content, style }) : null;

  return (
    <details className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
      <summary className="cursor-pointer text-base font-semibold">Not sure where this should go? Answer three questions</summary>
      <div className="mt-4 space-y-4 text-sm">
        <Question
          label="Does it contain pseudonymised data — participant data that could be re-identified with a key kept somewhere?"
          value={data}
          onChange={setData}
          options={[
            ["pseudonymised", "Yes"],
            ["anonymised-or-none", "No — anonymised, or no participant data"],
          ]}
        />
        <Question
          label="Is it mainly code?"
          value={content}
          onChange={setContent}
          options={[
            ["code", "Yes, mainly code"],
            ["data-materials", "No — data, materials, or a mix"],
          ]}
        />
        <Question
          label="How do you prefer to upload?"
          value={style}
          onChange={setStyle}
          options={[
            ["point-and-click", "By hand, in a website"],
            ["either", "Either is fine"],
          ]}
        />

        {s && (
          <div className="rounded bg-neutral-50 p-4 dark:bg-neutral-900" data-testid="destination-suggestion">
            <p className="font-medium">
              Suggested:{" "}
              <a href={s.primary.url} target="_blank" rel="noreferrer" className="underline">
                {s.primary.name}
              </a>
              {s.primary.automatic ? " — BetterOSF can transfer it for you" : ""}
            </p>
            <p className="mt-1 text-neutral-700 dark:text-neutral-300">{s.reason}</p>
            <Steps d={s.primary} />
            {s.alternatives.length > 0 && (
              <div className="mt-3">
                <p className="text-neutral-600 dark:text-neutral-400">Also suitable:</p>
                {s.alternatives.map((alt) => (
                  <details key={alt.id} className="mt-1">
                    <summary className="cursor-pointer underline">{alt.name}</summary>
                    <Steps d={alt} />
                  </details>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-neutral-500">
              A suggestion from three answers, based on{" "}
              <a
                href="https://daniellakens.blogspot.com/2026/08/which-data-repository-should-you-use.html"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Lakens&apos; comparison of data repositories
              </a>
              , not professional advice. Check your ethics approval, consent forms and funder rules. Before
              moving, make sure the project has a licence —{" "}
              <Link href="/tools/licence-check" className="underline">
                check it here
              </Link>
              .
            </p>
          </div>
        )}
      </div>
    </details>
  );
}

function Question<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | null;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <fieldset>
      <legend className="font-medium">{label}</legend>
      <div className="mt-1 flex flex-wrap gap-4">
        {options.map(([v, text]) => (
          <label key={v} className="flex items-center gap-2">
            <input type="radio" name={label} checked={value === v} onChange={() => onChange(v)} />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Steps({ d }: { d: Destination }) {
  return (
    <ol className="mt-2 list-decimal space-y-1 pl-5">
      {d.steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}
