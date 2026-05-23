import { getCount } from "@/lib/limits";
import { auth } from "@/auth";

const DAILY_CAP = 10_000;
const WARN_AT = 9_500;

export async function QuotaBanner() {
  // Only meaningful for anonymous viewers
  const session = await auth().catch(() => null);
  if (session) return null;

  const today = new Date().toISOString().slice(0, 10);
  const used = await getCount(`app:osf:calls:${today}`);

  if (used >= DAILY_CAP) {
    return (
      <div className="bg-red-100 dark:bg-red-950 text-red-900 dark:text-red-100 px-4 py-2 text-sm border-b border-red-300 dark:border-red-800">
        BetterOSF is over its daily OSF API quota. Anonymous browsing may be unreliable until UTC midnight.{" "}
        <a href="/login" className="underline">Sign in</a> for full access.
      </div>
    );
  }
  if (used >= WARN_AT) {
    return (
      <div className="bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-100 px-4 py-2 text-sm border-b border-amber-200 dark:border-amber-800">
        BetterOSF is approaching its daily OSF API quota ({used}/{DAILY_CAP}). Pages may slow down later today.{" "}
        <a href="/login" className="underline">Sign in</a> to use your own quota.
      </div>
    );
  }
  return null;
}
