import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowSquareOut,
  DownloadSimple,
  Fire,
  LinkSimple,
  Lock,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";

import { api, ApiError, type PasteFile, type RevealPayload } from "@/api";
import { PageContainer } from "@/components/ui/page-container";
import { PageHead, MetaDot } from "@/components/page-head";
import { AppBack } from "@/components/back";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { CopyButton } from "@/components/ui/copy-button";
import { toast } from "sonner";
import { highlight } from "@/lib/highlight";
import { absolute, bytes, kindLabel, remaining } from "@/lib/format";
import { languageLabel, type LanguageId } from "@/lib/language";
import { useIsPublicHost, useShareBase } from "@/hooks/use-config";
import { useWrap } from "@/hooks/use-wrap";
import { clearDraft } from "@/lib/draft-store";

function CodeView({ text, language, wrap }: { text: string; language: string; wrap: boolean }) {
  const numbers = useMemo(
    () => text.split("\n").map((_, index) => index + 1).join("\n"),
    [text],
  );
  return (
    <div className="code-view" data-wrap={wrap ? "on" : "off"}>
      <div className="ed-gutter" aria-hidden="true">
        {numbers}
      </div>
      <pre
        className="code-pre"
        dangerouslySetInnerHTML={{ __html: highlight(text, language) }}
      />
    </div>
  );
}

/** An image keeps the file's name and size in a strip of its own: the page is a reader, not a gallery. */
function PasteImage({ slug, file }: { slug: string; file: PasteFile }) {
  return (
    <figure className="m-0">
      <img
        src={api.fileUrl(slug, file.id)}
        alt={file.name}
        className="block w-full"
        loading="lazy"
      />
      <figcaption className="flex h-9 items-center gap-2 border-t border-[var(--border)] bg-[var(--surface-2)] pl-3 pr-1">
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-3)]">{file.name}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-3)]">
          {bytes(file.size)}
        </span>
        <a
          href={api.fileUrl(slug, file.id, true)}
          download={file.name}
          aria-label={`Download ${file.name}`}
          className="grid size-8 shrink-0 place-items-center text-[var(--text-2)] no-underline hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
        >
          <DownloadSimple size={14} aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  );
}

export function PastePage() {
  const { slug } = useParams({ from: "/$slug" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<RevealPayload | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [password, setPassword] = useState("");
  const [wrap, setWrap] = useWrap();
  const isPublicHost = useIsPublicHost();
  const shareBase = useShareBase();

  const query = useQuery({
    queryKey: ["paste", slug],
    queryFn: () => api.get(slug),
    retry: (count, error) => !(error instanceof ApiError) && count < 1,
  });

  const reveal = useMutation({
    mutationFn: () => api.reveal(slug),
    onSuccess: (payload) => {
      setRevealed(payload);
      queryClient.invalidateQueries({ queryKey: ["pastes"] });
      queryClient.removeQueries({ queryKey: ["paste", slug] });
      toast("Burned");
    },
    onError: () => toast("Could not reveal"),
  });

  const unlock = useMutation({
    mutationFn: () => api.unlock(slug, password),
    onSuccess: async () => {
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: ["paste", slug] });
      toast("Unlocked");
    },
    onError: (error) =>
      toast(
        error instanceof ApiError && error.status === 401 ? "Wrong password" : "Could not unlock",
      ),
  });

  const remove = useMutation({
    mutationFn: () => api.remove(slug),
    onSuccess: () => {
      void clearDraft(slug);
      queryClient.invalidateQueries({ queryKey: ["pastes"] });
      queryClient.removeQueries({ queryKey: ["paste", slug] });
      toast("Deleted");
      navigate({ to: "/recent" });
    },
    onError: () => toast("Could not delete"),
  });

  const burnRequired = query.error instanceof ApiError && query.error.status === 409;
  const notFound =
    query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 410);

  if (notFound && !revealed) {
    return (
      <PageContainer className="py-7">
        {isPublicHost ? null : <AppBack fallbackHref="/recent" fallbackLabel="Back to recent" />}
        <EmptyState
          title="Gone"
          description="This paste expired, burned, or was deleted."
          action={
            <Link
              to="/recent"
              className="inline-flex h-8 items-center gap-2 border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm no-underline text-[var(--foreground)] hover:bg-[var(--surface-2)]"
            >
              Recent <ArrowRight size={14} aria-hidden="true" />
            </Link>
          }
        />
      </PageContainer>
    );
  }

  if (burnRequired && !revealed) {
    return (
      <PageContainer className="py-7">
        {isPublicHost ? null : <AppBack fallbackHref="/recent" fallbackLabel="Back to recent" />}
        <div className="mx-auto grid w-full max-w-[440px] gap-6">
          <div className="grid justify-items-center gap-1.5 text-center">
            <span className="m-label">{slug}</span>
            <h1 className="m-0 text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--foreground)]">
              Burn after reading
            </h1>
          </div>
          <div className="grid justify-items-center gap-5 border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center">
            <span className="grid size-11 place-items-center border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-2)]">
              <Fire size={20} aria-hidden="true" />
            </span>
            <div className="grid gap-2">
              <h2 className="m-0 text-[15px] font-medium text-[var(--foreground)]">Read once</h2>
              <p className="m-0 max-w-[34ch] text-sm leading-relaxed text-[var(--text-2)]">
                Opening this paste consumes it. It is removed on every device, and there is no second
                read.
              </p>
            </div>
            <button
              type="button"
              onClick={() => reveal.mutate()}
              disabled={reveal.isPending}
              className="inline-flex h-9 min-w-[132px] cursor-pointer items-center justify-center bg-[var(--primary)] px-5 text-sm font-medium text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {reveal.isPending ? "Revealing…" : "Reveal"}
            </button>
          </div>
        </div>
      </PageContainer>
    );
  }

  if (query.data?.locked) {
    return (
      <PageContainer className="py-7">
        {isPublicHost ? null : <AppBack fallbackHref="/recent" fallbackLabel="Back to recent" />}
        <div className="mx-auto grid w-full max-w-[440px] gap-6">
          <div className="grid justify-items-center gap-1.5 text-center">
            <span className="m-label">{slug}</span>
            <h1 className="m-0 text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--foreground)]">
              Password required
            </h1>
          </div>
          <form
            className="grid justify-items-center gap-4 border border-[var(--border)] bg-[var(--surface)] px-6 py-8 text-center"
            onSubmit={(event) => {
              event.preventDefault();
              if (password) unlock.mutate();
            }}
          >
            <span className="grid size-11 place-items-center border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-2)]">
              <Lock size={20} aria-hidden="true" />
            </span>
            <label className="grid w-full max-w-[280px] gap-1.5 text-left">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
                Password
              </span>
              <input
                type="password"
                value={password}
                autoFocus
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                className="h-9 w-full border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--text-3)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"
              />
            </label>
            <button
              type="submit"
              disabled={unlock.isPending || password === ""}
              className="inline-flex h-9 min-w-[132px] cursor-pointer items-center justify-center bg-[var(--primary)] px-5 text-sm font-medium text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {unlock.isPending ? "Unlocking…" : "Unlock"}
            </button>
          </form>
        </div>
      </PageContainer>
    );
  }

  if (query.isLoading) {
    return (
      <PageContainer className="py-7">
        {isPublicHost ? null : <AppBack fallbackHref="/recent" fallbackLabel="Back to recent" />}
        <div className="h-[240px] border border-[var(--border)] bg-[var(--surface-2)]" />
      </PageContainer>
    );
  }

  if (revealed) {
    return (
      <PageContainer className="py-7">
        {isPublicHost ? null : <AppBack fallbackHref="/recent" fallbackLabel="Back to recent" />}
        <PageHead
          eyebrow={slug}
          title={revealed.title || "Untitled paste"}
          meta={
            <>
              <span>Burned</span>
              <MetaDot />
              <span>this was the only read</span>
            </>
          }
        />
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          {revealed.text ? (
            <CodeView text={revealed.text} language={revealed.language} wrap={wrap} />
          ) : null}
          {revealed.files.map((file) => {
            const isImage = file.mime.startsWith("image/");
            const src = `data:${file.mime};base64,${file.data}`;
            return isImage ? (
              <img key={file.name} src={src} alt={file.name} className="block w-full" />
            ) : (
              <a
                key={file.name}
                href={src}
                download={file.name}
                className="flex h-11 items-center justify-between border-t border-[var(--border)] px-3 text-sm no-underline text-[var(--foreground)] hover:bg-[var(--surface-2)]"
              >
                {file.name}
                <DownloadSimple size={16} aria-hidden="true" />
              </a>
            );
          })}
        </div>
      </PageContainer>
    );
  }

  const paste = query.data;
  if (!paste) return null;

  const text = paste.text ?? "";
  const files = paste.files ?? [];
  const isText = text.length > 0;
  const images = files.filter((file) => file.mime.startsWith("image/"));
  const others = files.filter((file) => !file.mime.startsWith("image/"));
  const hasAttachments = files.length > 0;
  const total = paste.textBytes + paste.fileBytes;

  async function copyLink() {
    try {
      const base = paste!.visibility === "public" ? shareBase : window.location.origin;
      await navigator.clipboard.writeText(`${base}/${paste!.slug}`);
      toast("Link copied");
    } catch {
      toast("Clipboard blocked");
    }
  }

  return (
    <PageContainer className="py-7">
        {isPublicHost ? null : <AppBack fallbackHref="/recent" fallbackLabel="Back to recent" />}
      <PageHead
        eyebrow={paste.slug}
        title={paste.title || "Untitled paste"}
        meta={
          <>
            <span>{kindLabel(paste.kind)}</span>
            <MetaDot />
            <span>{bytes(total)}</span>
            <MetaDot />
            <span>
              {paste.views} {paste.views === 1 ? "view" : "views"}
            </span>
            <MetaDot />
            <span>
              {paste.burn ? "burn after reading" : `expires in ${remaining(paste.expiresAt)}`}
            </span>
          </>
        }
        actions={
          <>
            {isPublicHost ? null : (
            <Link
              to="/$slug/edit"
              params={{ slug: paste.slug }}
              aria-label="Edit"
              className="grid size-8 place-items-center border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            >
              <PencilSimple size={16} aria-hidden="true" />
            </Link>
            )}
            {/* Copying the link is the paste's one share action, so it says so and is always here —
                a paste with no text still has a URL. Copying the text belongs to the text. */}
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex h-8 cursor-pointer items-center gap-2 border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            >
              <LinkSimple size={16} aria-hidden="true" />
              Copy link
            </button>
            {isText ? (
              <a
                href={api.rawUrl(paste.slug)}
                download={`${paste.slug}.txt`}
                aria-label="Download text"
                className="grid size-8 place-items-center border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              >
                <DownloadSimple size={16} aria-hidden="true" />
              </a>
            ) : null}
            {isPublicHost ? null : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete"
                className="grid size-8 cursor-pointer place-items-center border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--destructive)]"
              >
                <Trash size={16} aria-hidden="true" />
              </button>
            )}
          </>
        }
      />

      <div className="border border-[var(--border)] bg-[var(--surface)]">
        {/* Attachments lead: they are what the paste is about when it has any. */}
        {images.length > 0 ? (
          <div className="grid">
            {images.map((file) => (
              <PasteImage key={file.id} slug={paste.slug} file={file} />
            ))}
          </div>
        ) : null}

        {others.map((file) => (
          <div
            key={file.id}
            className="flex h-11 items-center gap-3 border-t border-[var(--border)] pl-3 pr-1 text-sm text-[var(--foreground)] hover:bg-[var(--surface-2)]"
          >
            {/* The row opens the file; the icon saves it. Two different intentions, two targets. */}
            <a
              href={api.fileUrl(paste.slug, file.id)}
              target="_blank"
              rel="noopener"
              className="flex min-w-0 flex-1 items-center gap-3 no-underline text-[var(--foreground)]"
              aria-label={`Open ${file.name}`}
            >
              <span className="truncate">{file.name}</span>
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--text-3)]">
                {bytes(file.size)}
              </span>
            </a>
            <a
              href={api.fileUrl(paste.slug, file.id, true)}
              download={file.name}
              aria-label={`Download ${file.name}`}
              className="grid size-9 shrink-0 place-items-center text-[var(--text-2)] no-underline hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            >
              <DownloadSimple size={16} aria-hidden="true" />
            </a>
          </div>
        ))}

        {isText ? (
          <section className={hasAttachments ? "border-t border-[var(--border)]" : undefined}>
            <div className="flex h-10 items-center justify-between gap-3 border-b border-[var(--border)] px-3">
              {/* The section is named after what it holds — the paste's text in its language, never a
                  filename it does not have. */}
              <span className="text-xs text-[var(--text-2)]">
                {languageLabel(paste.language as LanguageId)}
              </span>
              <span className="flex items-center gap-1 text-[11px] tabular-nums">
                <button
                  type="button"
                  onClick={() => setWrap(!wrap)}
                  aria-pressed={wrap}
                  title={wrap ? "Wrap is on" : "Wrap is off"}
                  className={`h-7 cursor-pointer px-2 text-xs ${wrap ? "bg-[var(--surface-2)] text-[var(--foreground)]" : "text-[var(--text-2)] hover:bg-[var(--surface-2)]"}`}
                >
                  Wrap
                </button>
                <a
                  href={api.rawUrl(paste.slug)}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex h-7 items-center gap-1 px-1.5 text-[var(--text-2)] no-underline hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                >
                  Raw <ArrowSquareOut size={12} aria-hidden="true" />
                </a>
                <CopyButton value={text} label="Copy text" size="sm" className="ml-1" />
              </span>
            </div>
            <CodeView text={text} language={paste.language} wrap={wrap} />
          </section>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] tabular-nums text-[var(--text-3)]">
        <span>
          Created {absolute(paste.createdAt)} · Updated {absolute(paste.updatedAt)}
        </span>
        {isPublicHost ? null : (
          <Link
            to="/"
            search={{ duplicate: paste.slug }}
            className="flex items-center gap-1.5 text-[var(--text-2)] no-underline hover:text-[var(--foreground)]"
          >
            Duplicate <ArrowRight size={12} aria-hidden="true" />
          </Link>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this paste?"
        body="The paste and its files are deleted permanently. This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </PageContainer>
  );
}
