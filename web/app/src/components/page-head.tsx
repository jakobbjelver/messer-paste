import type { ReactNode } from "react";

/**
 * The screen header: mono eyebrow, Golos title, mono meta line, right-aligned actions.
 * The registry's PageHeader takes a 14px sans description; the handover's meta line is mono, so this
 * is the app's one shape until the block grows a `meta` prop (recorded in MESSER.md).
 */
export function PageHead({
  eyebrow,
  title,
  meta,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="grid min-w-0 gap-1.5">
        <span className="m-label">{eyebrow}</span>
        <h1 className="m-0">{title}</h1>
        {meta ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tabular-nums text-[var(--text-3)]">
            {meta}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function MetaDot() {
  return <span aria-hidden="true">·</span>;
}
