import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FloppyDisk, Lock, Paperclip, Plus, UploadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";

import { api, ApiError, isSessionExpiredError, type PasteDetail } from "@/api";
import { PageContainer } from "@/components/ui/page-container";
import { PageHead, MetaDot } from "@/components/page-head";
import { AppBack, expectReplace } from "@/components/back";
import { Editor } from "@/components/editor";
import { Attachments } from "@/components/attachments";
import { PasteOptions } from "@/components/paste-options";
import { useDraft } from "@/hooks/use-draft";
import { useDraftPersistence } from "@/hooks/use-draft-persistence";
import { useWrap } from "@/hooks/use-wrap";
import { useConfig, useShareBase } from "@/hooks/use-config";
import { detectLanguage, languageLabel, type LanguageId } from "@/lib/language";
import { previewTitle } from "@/lib/title";
import { validateDraft, type FieldError } from "@/lib/validation";
import { absolute, bytes } from "@/lib/format";

export type ComposerMode = "create" | "edit";

export function ComposerScreen({
  mode,
  slug,
  initial,
  duplicate,
}: {
  mode: ComposerMode;
  slug?: string;
  initial?: PasteDetail;
  duplicate?: PasteDetail;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const shareBase = useShareBase();
  const { data: config } = useConfig();
  const { draft, set, addFiles, removeFile, reset, load, hydrate, counts } = useDraft();
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [dragging, setDragging] = useState(false);
  const [wrap, setWrap] = useWrap();
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const loadedFor = useRef<string | null>(null);

  // The server's copy fills the draft once per paste. Re-running it on every refetch (a live event,
  // a window focus) is what used to replace in-progress text and silently drop attached files.
  useEffect(() => {
    if (!initial || mode !== "edit" || !slug || loadedFor.current === slug) return;
    loadedFor.current = slug;
    load(initial);
  }, [initial, load, mode, slug]);

  // A draft belongs to a paste, not to a tab: the composer has one, each edit has its own.
  const persistence = useDraftPersistence({
    key: mode === "edit" && slug ? slug : "new",
    draft,
    serverUpdatedAt: mode === "edit" ? initial?.updatedAt : undefined,
    onHydrate: hydrate,
    enabled: !duplicate,
  });

  useEffect(() => {
    if (!duplicate) return;
    set({
      title: duplicate.title,
      text: duplicate.text,
      language: duplicate.language as LanguageId,
      expiresIn: 86_400,
      burn: false,
    });
    let cancelled = false;
    void (async () => {
      const files = await Promise.all(
        (duplicate.files ?? []).map(async (file) => {
          const response = await fetch(api.fileUrl(duplicate.slug, file.id));
          const blob = await response.blob();
          return new File([blob], file.name, { type: file.mime });
        }),
      );
      if (!cancelled && files.length > 0) addFiles(files);
    })();
    return () => {
      cancelled = true;
    };
  }, [addFiles, duplicate, set]);

  const detected = useMemo<LanguageId>(
    () =>
      draft.language === "auto"
        ? detectLanguage(draft.text, draft.files[0]?.name)
        : (draft.language as LanguageId),
    [draft.language, draft.text, draft.files],
  );

  const hasText = draft.text.trim().length > 0;
  const commitLabel = mode === "edit" ? "Save" : "Create";

  const submit = useCallback(async () => {
    if (pending) return;
    const problems = validateDraft(draft);
    if (problems.length > 0) {
      setFieldErrors(problems);
      toast("Check the highlighted fields", { description: problems[0].message });
      const selector =
        problems[0].field === "text" ? "#paste-source" : `[data-field="${problems[0].field}"]`;
      document.querySelector<HTMLElement>(selector)?.focus();
      return;
    }
    setFieldErrors([]);
    if (!hasText && draft.files.length === 0) return;
    setPending(true);
    const form = new FormData();
    form.append("title", draft.title);
    form.append("text", draft.text);
    form.append("language", draft.language);
    form.append("expires_in", String(draft.expiresIn));
    form.append("burn", draft.burn ? "1" : "0");
    form.append("visibility", draft.visibility);
    form.append("max_views", String(draft.maxViews));
    if (draft.password) form.append("password", draft.password);
    if (draft.clearPassword) form.append("clear_password", "1");
    for (const file of draft.files) {
      if (file.file) form.append("file", file.file, file.name);
      else if (file.id) form.append("keep", String(file.id));
    }
    try {
      const saved =
        mode === "edit" && slug ? await api.update(slug, form) : await api.create(form);
      await queryClient.invalidateQueries({ queryKey: ["pastes"] });
      const link = `${saved.visibility === "public" ? shareBase : window.location.origin}/${saved.slug}`;
      let copied = false;
      try {
        if (!config?.copy_on_create) throw new Error("off");
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch {
        /* clipboard blocked */
      }
      toast(mode === "edit" ? "Saved" : copied ? "Created · copied" : "Created");
      // The draft is now the server's copy: stop mirroring it, and let the paste page own the
      // history entry the editor was using.
      persistence.clear();
      if (mode === "create") reset();
      if (mode === "edit" && slug) expectReplace(`/${saved.slug}`);
      navigate({ to: "/$slug", params: { slug: saved.slug }, replace: mode === "edit" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        toast("Gone · deleted elsewhere");
        navigate({ to: "/recent" });
      } else if (error instanceof ApiError && error.status === 413) {
        toast.error("Could not save the paste", { description: "It is larger than the limit." });
      } else if (error instanceof ApiError && error.field) {
        setFieldErrors([{ field: error.field as FieldError["field"], message: error.message }]);
        toast.error("Could not save the paste", { description: error.message });
      } else if (isSessionExpiredError(error)) {
        // The banner says what to do; this only stops the old vague sentence from lying about it.
        toast.error("Could not save the paste", { description: "Your Access session expired." });
      } else if (error instanceof ApiError) {
        toast.error("Could not save the paste", { description: error.message });
      } else {
        toast.error("Could not save the paste", { description: "The server did not answer." });
      }
    } finally {
      setPending(false);
    }
  }, [draft, mode, navigate, pending, persistence, queryClient, reset, shareBase, slug, hasText]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    };
    // Files pasted anywhere in the composer attach; text belongs to the focused editor, so leave it
    // alone instead of swallowing it.
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files);
      toast(`${files.length} ${files.length === 1 ? "file" : "files"} attached`);
    };
    // A fast typist can beat the auto-focus (and a click on the card does not focus the textarea).
    // Take the character that landed outside a field, put it where it was meant to go, and focus.
    const onFreeKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
      if (active?.isContentEditable) return;
      const source = document.getElementById("paste-source") as HTMLTextAreaElement | null;
      if (!source) return;
      event.preventDefault();
      set({ text: `${draft.text}${event.key}` });
      source.focus();
      requestAnimationFrame(() => {
        source.selectionStart = source.selectionEnd = source.value.length;
      });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onFreeKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onFreeKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [addFiles, draft.text, set, submit]);

  // A phone opens the keyboard the moment the editor takes focus, which covers half the screen before
  // a single word is written. A mouse keeps the caret parked where typing starts.
  const coarsePointer = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
    [],
  );

  // Public links off means private, always: a draft left on "public" from an earlier session would
  // otherwise keep the burn switch disabled and explain a rule about a feature that is not here.
  useEffect(() => {
    if (config && !config.public_links && draft.visibility !== "private") {
      set({ visibility: "private" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.public_links]);

  // A fresh draft takes the deployment's defaults once: the expiry preset and whether it starts
  // private. It never overwrites something the person already chose.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !config || mode === "edit") return;
    seeded.current = true;
    set({
      expiresIn: config.default_expiry,
      visibility: config.default_visibility,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, mode]);

  const onFiles = (files: File[]) => {
    if (files.length === 0) return;
    addFiles(files);
    toast(`${files.length} ${files.length === 1 ? "file" : "files"} attached`);
  };

  return (
    <PageContainer className="py-7">
      {mode === "edit" && slug ? (
        <AppBack fallbackHref={`/${slug}`} fallbackLabel="Back to the paste" />
      ) : null}
      <PageHead
        eyebrow={mode === "edit" && slug ? `Editing · ${slug}` : "Draft"}
        title={
          <input
            value={draft.title}
            onChange={(event) => set({ title: event.target.value })}
            onKeyDown={(event) => {
              // Tab out of the title lands in the text, which is what a person writing a paste wants
              // next — not the Attach button in the header.
              if (event.key !== "Tab" || event.shiftKey) return;
              const source = document.getElementById("paste-source") as HTMLTextAreaElement | null;
              if (!source) return;
              event.preventDefault();
              source.focus();
              source.selectionStart = source.selectionEnd = source.value.length;
            }}
            placeholder={previewTitle(draft.text, draft.files)}
            aria-label="Title"
            className="h-9 w-full min-w-[12ch] truncate bg-transparent font-sans text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--foreground)] text-ellipsis outline-none placeholder:text-[var(--text-3)]"
          />
        }
        meta={
          mode === "edit" && initial ? (
            <>
              <span>{languageLabel(detected)}</span>
              <MetaDot />
              <span>{bytes(initial.textBytes + initial.fileBytes)}</span>
              <MetaDot />
              <span>updated {absolute(initial.updatedAt)}</span>
            </>
          ) : (
            <>
              <span>{duplicate ? "Duplicate" : "New paste"}</span>
              <MetaDot />
              <span>
                expires {draft.expiresIn === 86_400 ? "in 24h" : draft.expiresIn === 3600 ? "in 1h" : draft.expiresIn === 604_800 ? "in 7d" : "never"}
              </span>
            </>
          )
        }
        actions={
          <>
            {mode === "edit" ? (
              <Link
                to="/$slug"
                params={{ slug: slug ?? "" }}
                className="inline-flex h-8 items-center border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--text-2)] no-underline hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              >
                Cancel
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="inline-flex h-8 cursor-pointer items-center gap-2 border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--foreground)] hover:bg-[var(--surface-2)]"
            >
              <Paperclip size={16} aria-hidden="true" />
              Attach
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                onFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </>
        }
      />

      {config?.read_only ? (
        <div className="mb-4 flex items-start gap-2 border border-[var(--border-strong)] bg-[var(--surface-2)] px-3 py-2 text-[12.5px] leading-snug text-[var(--text-2)]">
          <Lock size={14} aria-hidden="true" className="mt-px shrink-0 text-[var(--text-3)]" />
          Writes are frozen: this archive is read-only until the owner lifts it in settings.
        </div>
      ) : null}

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          onFiles(Array.from(event.dataTransfer?.files ?? []));
        }}
        data-dropzone="true"
        data-dragging={dragging ? "true" : undefined}
        className="relative grid grid-rows-[minmax(160px,26dvh)_auto] border border-[var(--border)] bg-[var(--surface)] lg:h-[538px] lg:grid-rows-1 lg:grid-cols-[minmax(0,1fr)_264px] lg:overflow-hidden"
      >
        <div
          className="flex min-h-0 min-w-0 cursor-text flex-col border-b border-[var(--border)] lg:border-b-0 lg:border-r"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("button, a, input, textarea, figure")) return;
            document.getElementById("paste-source")?.focus();
          }}
        >
          <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-3">
            <span className="flex items-center gap-2 text-xs tabular-nums text-[var(--text-2)]">
              <span>{languageLabel(detected)}</span>
              {draft.language === "auto" ? (
                <>
                  <span aria-hidden="true" className="text-[var(--text-3)]">·</span>
                  <span className="text-[var(--text-3)]">Auto</span>
                </>
              ) : null}
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setWrap(!wrap)}
                aria-pressed={wrap}
                className={`h-7 cursor-pointer px-2 text-xs ${wrap ? "bg-[var(--surface-2)] text-[var(--foreground)]" : "text-[var(--text-2)] hover:bg-[var(--surface-2)]"}`}
              >
                Wrap
              </button>
              {hasText ? (
                <span className="px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
                  UTF-8
                </span>
              ) : null}
            </span>
          </div>

          {draft.files.length > 0 ? (
            <div
              className={`shrink-0 overflow-y-auto border-b border-[var(--border)] p-3 ${hasText ? "max-h-[45%]" : "max-h-[60%]"}`}
            >
              <Attachments files={draft.files} slug={slug} onRemove={removeFile} />
            </div>
          ) : null}

          <Editor
            id="paste-source"
            value={draft.text}
            onChange={(text) => set({ text })}
            language={detected}
            wrap={wrap}
            placeholder="Paste or type… drop files anywhere"
            autoFocus={!coarsePointer}
          />

          <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-3 text-[11px] tabular-nums text-[var(--text-3)]">
            <span aria-label={`${counts.lines} lines, ${bytes(counts.textBytes)}`}>
              {counts.lines} {counts.lines === 1 ? "line" : "lines"} · {bytes(counts.textBytes)}
            </span>
            {draft.files.length > 0 ? (
              <span>
                {draft.files.length} {draft.files.length === 1 ? "file" : "files"} ·{" "}
                {bytes(counts.fileBytes)}
              </span>
            ) : null}
          </div>
        </div>

        <PasteOptions
          draft={draft}
          set={(patch) => {
            if (fieldErrors.length > 0) setFieldErrors([]);
            set(patch);
          }}
          detected={detected}
          pending={pending}
          ctaLabel={commitLabel}
          ctaIcon={mode === "edit" ? <FloppyDisk size={16} /> : <Plus size={16} weight="bold" />}
          onSubmit={() => void submit()}
          onClearFiles={() => {
            for (const file of draft.files) removeFile(file.key);
          }}
          locked={initial?.locked}
          errors={fieldErrors}
          expiryChoices={(config?.expiry_choices ?? []).map((choice) => ({
            value: choice.seconds,
            label: choice.seconds === 0 ? null : choice.label,
          }))}
          publicLinks={config?.public_links ?? false}
          burnEnabled={config?.burn_enabled ?? true}
          passwordRequired={config?.password_required ?? false}
          readOnly={config?.read_only ?? false}
        />

        {dragging ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center border border-dashed border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--surface)_82%,transparent)]">
            <span className="flex items-center gap-2 text-sm text-[var(--foreground)]">
              <UploadSimple size={18} aria-hidden="true" />
              Drop to attach
            </span>
          </div>
        ) : null}
      </div>
    </PageContainer>
  );
}

export function ComposerPage() {
  const { duplicate } = useSearch({ from: "/" });
  const { data } = useQuery({
    queryKey: ["paste", duplicate ?? "none"],
    queryFn: () => api.get(duplicate as string),
    enabled: Boolean(duplicate),
  });
  return <ComposerScreen mode="create" duplicate={duplicate ? data : undefined} />;
}
