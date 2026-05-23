export default function NotFound() {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-2">Project not found</h1>
      <p className="text-neutral-600">
        This OSF project doesn&apos;t exist or the GUID is malformed. <a href="/" className="underline">Go home</a>.
      </p>
    </div>
  );
}
