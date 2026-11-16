import type { CSSProperties } from "react";
import { CheckCircle, Info, Warning, WarningOctagon } from "@phosphor-icons/react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Canon sonner: square, hairline, mono 12px, bottom-right, 2400 ms. The theme is passed in by the
 * shell (this app owns its own theme hook) instead of read from next-themes.
 */
export function Toaster({ dark, ...props }: ToasterProps & { dark: boolean }) {
  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      position="bottom-right"
      duration={2400}
      visibleToasts={3}
      offset={16}
      style={
        {
          "--border-radius": "0px",
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border-strong)",
        } as CSSProperties
      }
      icons={{
        success: <CheckCircle size={14} aria-hidden="true" />,
        info: <Info size={14} aria-hidden="true" />,
        warning: <Warning size={14} aria-hidden="true" />,
        error: <WarningOctagon size={14} aria-hidden="true" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "rounded-none border border-[var(--border-strong)] bg-[var(--surface)] font-sans text-[13px] text-[var(--foreground)] shadow-[var(--shadow-pop)]",
          description: "text-[var(--text-2)]",
          actionButton: "rounded-none border border-[var(--border-strong)] bg-[var(--surface-2)] font-mono text-xs",
          cancelButton: "rounded-none border border-[var(--border-strong)] bg-[var(--surface)] font-mono text-xs",
        },
      }}
      {...props}
    />
  );
}
