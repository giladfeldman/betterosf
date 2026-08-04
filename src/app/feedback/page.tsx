import { FeedbackForm } from "@/components/FeedbackForm";
import { APP_VERSION_LABEL } from "@/lib/version";

export const metadata = {
  title: "Report a bug — BetterOSF",
  description: "Report a bug, suggest an idea, or ask a question about BetterOSF.",
};

export default function FeedbackPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-3xl font-semibold">Report a bug</h1>
      <p className="mb-6 text-neutral-700 dark:text-neutral-300">
        Found something broken, confusing, or missing? Tell us. Reports go straight to the
        maintainer. You don&apos;t need an account, and you don&apos;t need to leave an email
        address.
      </p>

      <FeedbackForm />

      <div className="mt-8 border-t border-neutral-200 pt-4 text-sm text-neutral-500 dark:border-neutral-800">
        <p>
          You&apos;re running <strong>BetterOSF {APP_VERSION_LABEL}</strong>. This is sent with your
          report so we know which build you saw the problem on.
        </p>
        <p className="mt-2">
          Prefer email? Write to{" "}
          <a className="text-blue-600 hover:underline dark:text-blue-400" href="mailto:betterosf@scimeto.app">
            betterosf@scimeto.app
          </a>
          . Data on OSF itself is never changed by a report.
        </p>
      </div>
    </div>
  );
}
