import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
 * The app's confirm surface: an AlertDialog (Radix) so it centres itself and traps focus. The
 * registry still has no dialog item; the atom is vendored from messer-portal and squared off in
 * `alert-dialog.tsx` (declared in MESSER.md).
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
  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-semibold">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-relaxed text-[var(--text-2)]">
            {body}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} className="h-8 px-4 text-sm">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={
              danger
                ? "h-8 border border-[color-mix(in_oklab,var(--destructive)_42%,var(--border))] bg-[var(--surface)] px-4 text-sm text-[var(--destructive)] hover:bg-[color-mix(in_oklab,var(--destructive)_9%,transparent)]"
                : "h-8 border border-[var(--primary)] bg-[var(--primary)] px-4 text-sm text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)]"
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
