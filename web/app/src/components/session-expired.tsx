import { useEffect, useSyncExternalStore } from "react";
import { Warning } from "@phosphor-icons/react";

import { PageContainer } from "@/components/ui/page-container";
import { isSessionExpired, reauthenticate, subscribeSession } from "@/lib/session";

function useSessionExpired(): boolean {
  return useSyncExternalStore(subscribeSession, isSessionExpired, () => false);
}

/**
 * The one thing an installed app cannot do for itself: get a new Access session. Shown instead of a
 * toast because it has to outlive the toast, and because it explains why nothing works — the server
 * is fine, the browser holds no session for this host.
 */
export function SessionExpired() {
  const expired = useSessionExpired();

  if (!expired) return null;

  return (
    <PageContainer className="pt-4">
      <div
        role="alert"
        className="flex flex-wrap items-start gap-3 border border-[color-mix(in_oklab,var(--destructive)_42%,var(--border))] bg-[color-mix(in_oklab,var(--destructive)_6%,var(--surface))] px-3 py-2.5"
      >
        <Warning
          size={16}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-[var(--destructive)]"
        />
        <div className="min-w-0 flex-1">
          {/* `.m-label` owns the type and its own colour; the tint has to be its own element. */}
          <span className="m-label">
            <span className="text-[var(--destructive)]">Session expired</span>
          </span>
          <p className="m-0 mt-1 text-[13px] leading-snug text-[var(--text-2)]">
            This device holds no Access session, so every call is refused. The pastes are untouched.
          </p>
        </div>
        {/* Its own row on a phone: sharing one row squeezed the sentence into a four-line column. */}
        <button
          type="button"
          onClick={() => reauthenticate()}
          className="h-9 w-full cursor-pointer border border-[var(--primary)] bg-[var(--primary)] text-sm text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] sm:h-8 sm:w-auto sm:shrink-0 sm:px-4"
        >
          Sign in again
        </button>
      </div>
    </PageContainer>
  );
}

/**
 * Where the banner's button lands. The worker must not answer this path (see vite.config.ts), so the
 * request reaches the edge, Access redirects to its login page, and the returned page is this route
 * again — which means the cookie is now set and the app can go back to work.
 */
export function ReauthPage() {
  useEffect(() => {
    window.location.replace("/recent");
  }, []);

  return (
    <div className="mx-auto w-full max-w-[var(--shell)] px-4 py-16 md:px-8">
      <p className="m-0 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
        Signing you back in…
      </p>
    </div>
  );
}
