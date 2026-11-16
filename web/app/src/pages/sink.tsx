import { ImageSquare, Plus } from "@phosphor-icons/react";

import { PageContainer } from "@/components/ui/page-container";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Switch } from "@/components/switch";

/**
 * The canon's kitchen sink at /ui: every atom and state the conformance harness measures, with the
 * `data-state-*` fixtures it needs. No data fetching and no EventSource — `check.mjs` waits for
 * networkidle, and a live stream there is a navigation timeout, not a finding.
 */
export function SinkPage() {
  return (
    <PageContainer className="grid gap-8 py-8">
      <header className="grid gap-1">
        <span className="m-label">Messer UI</span>
        <h1>Paste specimens</h1>
        <p className="m-0 text-[11px] tabular-nums text-[var(--text-3)]">
          Every control, one state each. The harness measures this page, not the app screens.
        </p>
      </header>

      <section className="grid gap-3">
        <h3 className="m-label">Buttons</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button className="inline-flex h-9 cursor-pointer items-center gap-2 bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]">
            <Plus size={16} aria-hidden="true" /> Primary
          </button>
          <button className="inline-flex h-8 cursor-pointer items-center border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm hover:bg-[var(--surface-2)]">
            Secondary
          </button>
          <button className="inline-flex h-7 cursor-pointer items-center border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-xs hover:bg-[var(--surface-2)]">
            Compact
          </button>
          <button className="inline-flex h-8 cursor-pointer items-center border border-[color-mix(in_oklab,var(--destructive)_42%,var(--border))] px-3 text-sm text-[var(--destructive)] hover:bg-[color-mix(in_oklab,var(--destructive)_9%,transparent)]">
            Danger
          </button>
          <button
            disabled
            aria-disabled="true"
            className="inline-flex h-8 cursor-not-allowed items-center border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 text-sm text-[var(--text-3)] opacity-50"
            data-state-disabled
          >
            Disabled
          </button>
          <button
            data-state-hover
            className="inline-flex h-8 items-center border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm hover:bg-[var(--surface-2)]"
            aria-label="Hover fixture"
          >
            Hover
          </button>
          <button
            data-state-focus
            className="inline-flex h-8 items-center border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm"
            aria-label="Focus fixture"
          >
            Focus
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            data-state-selected
            aria-pressed="true"
            className="relative inline-flex h-8 items-center border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] px-3 text-sm after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[var(--primary)] after:content-['']"
          >
            Selected
          </button>
          <button
            aria-pressed="false"
            className="inline-flex h-8 items-center border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm hover:bg-[var(--surface-2)]"
          >
            Unselected
          </button>
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="m-label">Fields</h3>
        <div className="grid max-w-[420px] gap-3">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Title</span>
            <input
              className="h-8 border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-sm outline-none"
              placeholder="Untitled paste"
            />
          </label>
          <Switch checked onChange={() => {}} label="Burn after reading" hint="One read, then gone." />
          <div className="flex items-center gap-2">
            <kbd className="m-kbd">⌘</kbd>
            <kbd className="m-kbd">V</kbd>
            <span className="text-xs text-[var(--text-3)]">from clipboard</span>
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="m-label">Status</h3>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status="success">Live</StatusBadge>
          <StatusBadge status="warning">Expiring</StatusBadge>
          <StatusBadge status="danger">Failed</StatusBadge>
          <StatusBadge status="neutral">Idle</StatusBadge>
          <StatusBadge status="paused">Paused</StatusBadge>
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="m-label">Data</h3>
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="grid h-9 grid-cols-[minmax(0,1fr)_96px_84px] items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-3">
            <span className="m-label">Paste</span>
            <span className="m-label text-right">Size</span>
            <span className="m-label text-right">Expires</span>
          </div>
          <div className="grid h-[52px] grid-cols-[minmax(0,1fr)_96px_84px] items-center gap-3 border-b border-[var(--border)] px-3 hover:bg-[var(--surface-2)]">
            <span className="grid gap-0.5">
              <span className="text-sm">portal-dev restart notes</span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
                B91E04AA
              </span>
            </span>
            <span className="text-right text-[11px] tabular-nums text-[var(--text-2)]">1.1 KB</span>
            <span className="text-right text-[11px] tabular-nums text-[var(--text-2)]">21h</span>
          </div>
          <div className="grid h-[52px] grid-cols-[minmax(0,1fr)_96px_84px] items-center gap-3 px-3 hover:bg-[var(--surface-2)]">
            <span className="grid gap-0.5">
              <span className="text-sm">two screenshots</span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
                6YTZV5LW
              </span>
            </span>
            <span className="text-right text-[11px] tabular-nums text-[var(--text-2)]">1.4 MB</span>
            <span className="text-right text-[11px] tabular-nums text-[var(--text-2)]">never</span>
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="m-label">Empty</h3>
        <EmptyState
          icon={<ImageSquare />}
          title="Nothing here"
          description="The empty state is a state: same paper, one action."
        />
      </section>
    </PageContainer>
  );
}
