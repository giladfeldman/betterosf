"use client";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-2">Something broke</h1>
      <p className="text-neutral-600 mb-4">{error.message}</p>
      <button onClick={reset} className="border px-3 py-1 rounded">Retry</button>
    </div>
  );
}
