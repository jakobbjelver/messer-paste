import { useState } from "react";
import { Export, X } from "@phosphor-icons/react";

const KEY = "messer-paste-install-hint";

/**
 * iOS has no `beforeinstallprompt`: the only install path is Share → Add to Home Screen, so the
 * entire UX is an instruction. Shown once, dismissed for good, and only on the browser an iPhone
 * user actually has — an installed app or a desktop never sees it.
 */
function shouldShow(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return false;
  if ((navigator as Navigator & { standalone?: boolean }).standalone) return false;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  // Every iOS browser is WebKit, but only Safari has the Add to Home Screen action.
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return false;
  try {
    return localStorage.getItem(KEY) !== "dismissed";
  } catch {
    return true;
  }
}

export function InstallHint() {
  const [show, setShow] = useState(shouldShow);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, "dismissed");
    } catch {
      /* private mode */
    }
  };

  return (
    <div className="mb-4 flex items-start gap-3 border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <Export size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--text-2)]" />
      <div className="min-w-0 flex-1">
        <span className="m-label">Keep it on the home screen</span>
        <p className="m-0 mt-1 text-[13px] leading-snug text-[var(--text-2)]">
          Tap Share, then <span className="text-[var(--foreground)]">Add to Home Screen</span>. It
          opens full screen, with its own session.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss the install hint"
        className="-mr-1 grid size-7 shrink-0 cursor-pointer place-items-center text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
