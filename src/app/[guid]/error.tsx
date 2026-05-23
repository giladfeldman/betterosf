"use client";

export default function ProjectError({ error, reset }: { error: Error; reset: () => void }) {
  const msg = error.message.includes("forbidden")
    ? "This project is private. Sign-in support is coming in a later release."
    : error.message.includes("rate_limited")
    ? "BetterOSF is over capacity for today. Try again later."
    : "Something broke loading this project.";
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-2">Couldn&apos;t load this project</h1>
      <p className="text-neutral-600 mb-4">{msg}</p>
      <button onClick={reset} className="border px-3 py-1 rounded">Retry</button>
    </div>
  );
}
