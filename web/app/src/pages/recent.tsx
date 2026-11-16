import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Clock,
  FileText,
  Files,
  Fire,
  ImageSquare,
  Infinity as InfinityIcon,
  MagnifyingGlass,
  Trash,
  Warning,
} from "@phosphor-icons/react";

import { api, type PasteRow } from "@/api";
import { PageContainer } from "@/components/ui/page-container";
import { PageHead } from "@/components/page-head";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useLive } from "@/hooks/use-live-events";
import { toast } from "@/components/toast";
import { ago, bytes, expiringSoon, remaining } from "@/lib/format";

const COLUMNS = "grid-cols-[minmax(0,1fr)_96px_72px_84px] md:grid-cols-[minmax(0,1fr)_110px_76px_72px_96px]";

function kindIcon(kind: string) {
  switch (kind) {
    case "images":
      return <ImageSquare size={14} aria-hidden="true" />;
    case "files":
    case "mixed":
      return <Files size={14} aria-hidden="true" />;
    default:
      return <FileText size={14} aria-hidden="true" />;
  }
}

function Kind({ kind }: { kind: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--text-2)]">
      {kindIcon(kind)}
      {kind === "mixed" ? "Mixed" : kind === "images" ? "Images" : kind === "files" ? "Files" : "Text"}
    </span>
  );
}

function Expiry({ row }: { row: PasteRow }) {
  if (row.burn) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--text-2)]">
        <Fire size={14} aria-hidden="true" /> Burn
      </span>
    );
  }
  if (!row.expiresAt) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-[var(--text-3)]">
        <InfinityIcon size={14} aria-hidden="true" /> never
      </span>
    );
  }
  const soon = expiringSoon(row.expiresAt);
  const Icon = soon ? Warning : Clock;
  return (
    <span
      className={`flex items-center gap-1.5 text-xs ${soon ? "text-[var(--warning)]" : "text-[var(--text-2)]"}`}
    >
      <Icon size={14} aria-hidden="true" />
      {remaining(row.expiresAt)}
    </span>
  );
}

export function RecentPage() {
  const navigate = useNavigate();
  const live = useLive();
  const { data = [], isLoading, isError } = useQuery({ queryKey: ["pastes"], queryFn: api.list });
  const [search, setSearch] = useState("");
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!live.last?.slug) return;
    setFlash(live.last.slug);
    const timer = window.setTimeout(() => setFlash(null), 1400);
    return () => window.clearTimeout(timer);
  }, [live.last]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return data;
    return data.filter(
      (row) => row.title.toLowerCase().includes(needle) || row.slug.toLowerCase().includes(needle),
    );
  }, [data, search]);

  const total = data.reduce((sum, row) => sum + row.textBytes + row.fileBytes, 0);

  async function purge() {
    setPurgeOpen(false);
    try {
      const result = await api.purge();
      toast(`Purged ${result.deleted} ${result.deleted === 1 ? "paste" : "pastes"}`);
    } catch {
      toast("Purge failed");
    }
  }

  return (
    <PageContainer className="py-7">
      <PageHead
        eyebrow="Archive"
        title="Recent"
        actions={
          <button
            type="button"
            onClick={() => setPurgeOpen(true)}
            disabled={data.length === 0}
            className="inline-flex h-8 cursor-pointer items-center gap-2 border border-[color-mix(in_oklab,var(--destructive)_42%,var(--border))] bg-[var(--surface)] px-3 text-sm text-[var(--destructive)] hover:bg-[color-mix(in_oklab,var(--destructive)_9%,transparent)] disabled:cursor-not-allowed disabled:border-[var(--border-strong)] disabled:text-[var(--text-3)]"
          >
            <Trash size={16} aria-hidden="true" />
            Purge all
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <label className="relative flex w-full max-w-[280px] items-center">
          <MagnifyingGlass
            size={16}
            className="pointer-events-none absolute left-2.5 text-[var(--text-3)]"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            id="recent-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search pastes"
            aria-label="Search pastes"
            className="h-8 w-full border border-[var(--border-strong)] bg-[var(--surface)] pl-8 pr-2.5 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--text-3)]"
          />
        </label>
      </div>

      {isError ? (
        <EmptyState title="Could not load" description="The API did not answer. Check /readyz." />
      ) : isLoading ? (
        <div className="h-[52px] border border-[var(--border)] bg-[var(--surface-2)]" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={data.length === 0 ? "No pastes" : "No matches"}
          description={
            data.length === 0
              ? "Everything is gone. New paste, or wait for one to arrive."
              : "Nothing matches that search."
          }
          action={
            <Link
              to="/"
              search={{ duplicate: undefined }}
              className="inline-flex h-8 items-center gap-2 border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm no-underline text-[var(--foreground)] hover:bg-[var(--surface-2)]"
            >
              New paste
            </Link>
          }
        />
      ) : (
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div
            className={`grid h-9 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 ${COLUMNS}`}
          >
            <span className="m-label">Paste</span>
            <span className="m-label hidden md:block">Kind</span>
            <span className="m-label hidden text-right md:block">Size</span>
            <span className="m-label text-right">Updated</span>
            <span className="m-label text-right">Expires</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.slug}
              onClick={() => navigate({ to: "/$slug", params: { slug: row.slug } })}
              className={`grid h-[52px] cursor-pointer items-center gap-3 border-b border-[var(--border)] px-3 last:border-b-0 hover:bg-[var(--surface-2)] ${COLUMNS} ${
                flash === row.slug ? "row-flash" : ""
              }`}
              role="row"
            >
              <span className="grid min-w-0 gap-0.5">
                <Link
                  to="/$slug"
                  params={{ slug: row.slug }}
                  onClick={(event) => event.stopPropagation()}
                  className="truncate text-sm text-[var(--foreground)] no-underline hover:underline"
                >
                  {row.title || "Untitled paste"}
                </Link>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
                  {row.slug}
                  {row.burn ? " · burn" : ""}
                </span>
              </span>
              <span className="hidden md:block">
                <Kind kind={row.kind} />
              </span>
              <span className="hidden text-right font-mono text-[11px] text-[var(--text-2)] md:block">
                {bytes(row.textBytes + row.fileBytes)}
              </span>
              <span className="text-right font-mono text-[11px] text-[var(--text-2)]">
                {ago(row.updatedAt)}
              </span>
              <span className="justify-self-end">
                <Expiry row={row} />
              </span>
            </div>
          ))}
          <div className="flex h-9 items-center justify-between border-t border-[var(--border)] px-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
            <span>
              {data.length} {data.length === 1 ? "paste" : "pastes"} · {bytes(total)} stored
            </span>
            <span>{rows.length} shown</span>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={purgeOpen}
        title="Purge all pastes?"
        body={`All ${data.length} ${data.length === 1 ? "paste" : "pastes"} and their files will be permanently deleted. This cannot be undone.`}
        confirmLabel="Purge all"
        danger
        onConfirm={() => void purge()}
        onCancel={() => setPurgeOpen(false)}
      />
    </PageContainer>
  );
}
