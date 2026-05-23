import { SignInButton } from "@/components/SignInButton";

export const metadata = { title: "Sign in — BetterOSF" };

export default function LoginPage() {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-4">Sign in with OSF</h1>
      <p className="mb-6 text-neutral-600">
        BetterOSF uses OSF&apos;s OAuth to access your private projects. Read-only — no writes in v0.3.0.
      </p>
      <SignInButton />
      <p className="mt-8 text-xs text-neutral-500">
        Public OSF projects can be browsed without signing in — just paste a project URL or click an example on the <a href="/" className="underline">home page</a>.
      </p>
    </div>
  );
}
