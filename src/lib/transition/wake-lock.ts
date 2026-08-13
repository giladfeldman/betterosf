/**
 * Keep the screen awake while a transfer runs.
 *
 * A run over a large project takes hours, and on a laptop that closes its lid or dims to
 * sleep the tab is throttled or suspended — so the honest failure mode without this is
 * "I left it running overnight and it did four files".
 *
 * Best-effort by design. The Screen Wake Lock API is unavailable in Firefox and on some
 * mobile browsers, and the browser may release the lock at any time (notably when the tab
 * loses visibility, which is why re-acquisition is wired to `visibilitychange`). A caller
 * must never treat a wake lock as a guarantee that a run will survive — it is a courtesy,
 * and `supported()` is what the UI reads before promising anything.
 */

type WakeLockSentinelLike = {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
};

export function wakeLockSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator as WakeLockNavigator).wakeLock?.request === "function"
  );
}

export type WakeLockHandle = {
  /** Release the lock and stop re-acquiring it. Safe to call more than once. */
  release(): Promise<void>;
  /** True while we currently hold a lock. Reflects reality, not intent. */
  held(): boolean;
};

/**
 * Acquire a screen wake lock, re-acquiring it when the tab becomes visible again.
 *
 * Returns a handle even when the API is missing or the request is refused: the caller's
 * cleanup path should not have to branch on whether the courtesy was available. `held()`
 * is what reports the truth.
 */
export async function keepScreenAwake(): Promise<WakeLockHandle> {
  let sentinel: WakeLockSentinelLike | null = null;
  let stopped = false;

  const acquire = async () => {
    if (stopped || !wakeLockSupported() || document.visibilityState !== "visible") return;
    try {
      sentinel = await (navigator as WakeLockNavigator).wakeLock!.request("screen");
      sentinel.addEventListener("release", () => {
        sentinel = null;
      });
    } catch {
      // A refusal (low battery, policy, no user activation) is not an error worth
      // surfacing — the run continues either way.
      sentinel = null;
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible" && !sentinel) void acquire();
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  await acquire();

  return {
    held: () => Boolean(sentinel && !sentinel.released),
    async release() {
      stopped = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      const current = sentinel;
      sentinel = null;
      if (current && !current.released) await current.release().catch(() => {});
    },
  };
}
