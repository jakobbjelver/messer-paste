import { useEffect, useRef } from "react";

export type ConfirmProps = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A native <dialog>, styled to canon: square, `--border-strong`, ink overlay, 440px. The registry
 * still has no dialog item, so this is the app's local pattern (declared in MESSER.md) rather than a
 * vendored shadcn modal with rounded corners and a shadow.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onCancel();
      }}
      className="m-0 max-w-[440px] border border-[var(--border-strong)] bg-[var(--surface)] p-0 text-[var(--foreground)] backdrop:bg-black/45"
    >
      <div className="grid gap-3 p-5">
        <h3 className="m-0 font-mono text-base font-medium">{title}</h3>
        <p className="m-0 text-sm leading-relaxed text-[var(--text-2)]">{body}</p>
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 cursor-pointer items-center border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm hover:bg-[var(--surface-2)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              danger
                ? "inline-flex h-8 cursor-pointer items-center border border-[color-mix(in_oklab,var(--destructive)_42%,var(--border))] bg-[var(--surface)] px-4 text-sm text-[var(--destructive)] hover:bg-[color-mix(in_oklab,var(--destructive)_9%,transparent)]"
                : "inline-flex h-8 cursor-pointer items-center border border-[var(--primary)] bg-[var(--primary)] px-4 text-sm text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
