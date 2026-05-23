export default function NotFound() {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-2">Dashboard not available</h1>
      <p>Try <a href="/login" className="underline text-blue-600">signing in</a> again.</p>
    </div>
  );
}
