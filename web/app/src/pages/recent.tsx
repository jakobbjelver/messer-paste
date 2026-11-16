import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import {
  Clock,
  FileText,
  Files,
  Fire,
  ImageSquare,
  Infinity as InfinityIcon,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import { toast } from "sonner";

import { api, type PasteRow } from "@/api";
import { PageContainer } from "@/components/ui/page-container";
import { PageHead } from "@/components/page-head";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InstallHint } from "@/components/install-hint";
import { useLive } from "@/hooks/use-live-events";
import { ago, bytes, expiringSoon, remaining } from "@/lib/format";

// One row, two layouts: a card on a phone, a five-column table from md up. The tracks are declared
// only where they are used — a five-cell row in a four-track grid is what made the phone list read
// as "Paste Size" with zero-width columns.
const COLUMNS = "md:grid-cols-[minmax(0,1fr)_110px_76px_72px_96px]";

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

/** The server marks matches with \u0001/\u0002 so the fragment never carries markup. */
function Snippet({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(\u0001[^\u0002]*\u0002)/g), [text]);
  return (
    <span className="line-clamp-2 text-xs leading-relaxed text-[var(--text-3)]">
      {parts.map((part, index) =>
        part.startsWith("\u0001") ? (
          <mark
            key={index}
            className="bg-[color-mix(in_oklab,var(--warning)_30%,transparent)] px-0.5 text-[var(--foreground)]"
          >
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </span>
  );
}

function SkeletonRow() {
  return (
    <div className={`flex flex-col gap-1.5 border-b border-[var(--border)] px-4 py-3 last:border-b-0 md:grid ${COLUMNS} md:items-center md:gap-4`}>
      <span className="grid gap-1.5">
        <span className="h-3.5 w-[46%] bg-[var(--surface-2)]" />
        <span className="h-2.5 w-[64%] bg-[var(--surface-2)]" />
      </span>
      <span className="hidden h-3 w-12 bg-[var(--surface-2)] md:block" />
      <span className="hidden h-3 w-10 bg-[var(--surface-2)] md:block" />
      <span className="hidden h-3 w-14 bg-[var(--surface-2)] md:block" />
      <span className="hidden h-3 w-10 justify-self-end bg-[var(--surface-2)] md:block" />
    </div>
  );
}

function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)]" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonRow key={index} />
      ))}
    </div>
  );
}

export function RecentPage() {
  const { q } = useSearch({ from: "/recent" });
  const search = q ?? "";
  const live = useLive();
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const list = useInfiniteQuery({
    queryKey: ["pastes", search],
    queryFn: ({ pageParam }) =>
      api.list({ q: search || undefined, cursor: pageParam || undefined, limit: 50 }),
    initialPageParam: "",
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  });

  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;
  const took = list.data?.pages[0]?.tookMs ?? 0;

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !list.isFetchingNextPage && list.hasNextPage) {
          void list.fetchNextPage();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [list]);

  useEffect(() => {
    if (!live.last?.slug) return;
    setFlash(live.last.slug);
    const timer = window.setTimeout(() => setFlash(null), 1400);
    return () => window.clearTimeout(timer);
  }, [live.last]);

  const stored = rows.reduce((sum, row) => sum + row.textBytes + row.fileBytes, 0);

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
        eyebrow={`${total} ${total === 1 ? "paste" : "pastes"}${search ? ` · ${took} ms` : ""}`}
        title={search ? `Results for “${search}”` : "Recent"}
        meta={
          <>
            <span>{bytes(stored)} stored</span>
            <span aria-hidden="true" className="text-[var(--text-3)]">·</span>
            <span>newest first</span>
          </>
        }
        actions={
          rows.length > 0 ? (
            <button
              type="button"
              onClick={() => setPurgeOpen(true)}
              className="inline-flex h-8 cursor-pointer items-center gap-2 border border-[color-mix(in_oklab,var(--destructive)_42%,var(--border))] bg-[var(--surface)] px-3 text-sm text-[var(--destructive)] hover:bg-[color-mix(in_oklab,var(--destructive)_9%,transparent)]"
            >
              <Trash size={14} aria-hidden="true" />
              Purge all
            </button>
          ) : null
        }
      />

      <InstallHint />

      {list.isLoading ? (
        <SkeletonTable rows={6} />
      ) : list.isError ? (
        <p className="text-sm text-[var(--destructive)]">The archive could not be loaded.</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title={search ? "No matches" : "Nothing here yet"}
          description={
            search
              ? `Nothing matched “${search}” in a title, a filename or the text.`
              : "Pastes you create appear here."
          }
        />
      ) : (
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <div
            className={`hidden items-center gap-4 border-b border-[var(--border)] px-4 py-2 md:grid ${COLUMNS}`}
          >
            <span className="m-label">Paste</span>
            <span className="m-label">Kind</span>
            <span className="m-label hidden md:block">Updated</span>
            <span className="m-label">Expires</span>
            <span className="m-label hidden md:block text-right">Size</span>
          </div>
          {rows.map((row) => (
            <Link
              key={row.slug}
              to="/$slug"
              params={{ slug: row.slug }}
              className={`flex flex-col gap-1.5 border-b border-[var(--border)] px-4 py-3 text-[var(--foreground)] no-underline last:border-b-0 hover:bg-[var(--surface-2)] md:grid md:items-center md:gap-4 ${COLUMNS} ${
                flash === row.slug ? "bg-[var(--surface-2)]" : ""
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">{row.title}</span>
                {row.match ? (
                  <span className="mt-1 block">
                    <span className="mr-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
                      {row.match.field === "files" ? "file" : row.match.field}
                    </span>
                    <Snippet text={row.match.snippet} />
                  </span>
                ) : null}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 md:hidden">
                <Kind kind={row.kind} />
                <span aria-hidden="true" className="text-[var(--text-3)]">·</span>
                <span className="text-[11px] tabular-nums text-[var(--text-3)]">
                  {bytes(row.textBytes + row.fileBytes)}
                </span>
                <span aria-hidden="true" className="text-[var(--text-3)]">·</span>
                <Expiry row={row} />
                <span aria-hidden="true" className="text-[var(--text-3)]">·</span>
                <span className="text-[11px] tabular-nums text-[var(--text-3)]">
                  {ago(row.updatedAt)}
                </span>
              </span>
              <span className="hidden md:block">
                <Kind kind={row.kind} />
              </span>
              <span className="hidden text-[11px] tabular-nums text-[var(--text-3)] md:block">
                {ago(row.updatedAt)}
              </span>
              <span className="hidden md:block">
                <Expiry row={row} />
              </span>
              <span className="hidden text-right text-[11px] tabular-nums text-[var(--text-3)] md:block">
                {bytes(row.textBytes + row.fileBytes)}
              </span>
            </Link>
          ))}
          {list.isFetchingNextPage ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : null}
          <div ref={sentinel} className="grid h-10 place-items-center">
            {!list.hasNextPage && rows.length > 0 ? (
              <span className="text-[11px] tabular-nums text-[var(--text-3)]">
                {search ? `${total} ${total === 1 ? "match" : "matches"}` : `End of archive · ${total}`}
              </span>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={purgeOpen}
        title="Purge every paste?"
        body={`All ${total} pastes and their files will be permanently deleted. This cannot be undone.`}
        confirmLabel="Purge all"
        danger
        onConfirm={() => void purge()}
        onCancel={() => setPurgeOpen(false)}
      />
    </PageContainer>
  );
}
