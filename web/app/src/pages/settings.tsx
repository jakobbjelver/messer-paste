import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";

import { api, ApiError, type Setting } from "@/api";
import { PageContainer } from "@/components/ui/page-container";
import { PageHead, MetaDot } from "@/components/page-head";
import { AppBack } from "@/components/back";
import { InfoTip } from "@/components/ui/info-tip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useLive } from "@/hooks/use-live-events";
import { MIB, defaultLabel, durationLabel, inMiB, isDefault, lockReason } from "@/lib/settings";

/** The values a page edits: key → value, with the server's own shape preserved. */
type Draft = Record<string, unknown>;

function valuesOf(items: Setting[]): Draft {
  return Object.fromEntries(items.map((item) => [item.key, item.value]));
}

const PRESETS = ["1h", "24h", "7d", "30d", "0"];

/** The one font a meta label uses. R5 owns it; a button in the marker slot keeps it. */
const MARKER = "font-mono text-[10.5px] uppercase tracking-[0.1em]";

/**
 * One setting, one row: what it is on the left, the control and where its value comes from on the right.
 *
 * A row the environment owns cannot be edited here and says why twice: the variable's own name in a code
 * box, and a tip beside it that carries the rule. A row whose value is not the built-in default offers the
 * way back to it — and that is a draft edit, so the row turns dirty and Save is still the only write.
 */
function Row({
  item,
  value,
  onChange,
  error,
  dirty,
  onReset,
}: {
  item: Setting;
  value: unknown;
  onChange: (next: unknown) => void;
  error?: string;
  dirty?: boolean;
  onReset: () => void;
}) {
  const locked = !item.editable || item.source === "env" || item.boot;
  const atDefault = isDefault(item, value);
  const bytes = item.unit === "bytes";
  const field =
    "h-8 border bg-[var(--surface)] px-2 text-sm tabular-nums text-[var(--foreground)] outline-none placeholder:font-sans placeholder:text-[var(--text-3)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--text-3)] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

  const control = () => {
    if (item.kind === "bool") {
      return (
        <Switch
          checked={value === true}
          disabled={locked}
          onCheckedChange={(next) => onChange(next)}
          aria-label={item.label}
        />
      );
    }
    if (item.kind === "list" && item.choices?.length) {
      // The presets are buttons you turn on, not a string you spell.
      const chosen = String(value ?? "").split(",").map((part) => part.trim());
      return (
        <span className="flex flex-wrap items-center gap-1">
          {item.choices.map((choice) => {
            const on = chosen.includes(choice);
            return (
              <button
                key={choice}
                type="button"
                disabled={locked}
                aria-pressed={on}
                onClick={() => {
                  const next = on ? chosen.filter((c) => c !== choice) : [...chosen, choice];
                  if (next.length === 0) return;
                  onChange(PRESETS.filter((p) => next.includes(p)).join(","));
                }}
                className={`h-7 cursor-pointer border px-2 text-[11px] font-medium uppercase tracking-[0.06em] disabled:cursor-not-allowed ${
                  on
                    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]"
                }`}
              >
                {choice === "0" ? "never" : choice}
              </button>
            );
          })}
        </span>
      );
    }
    if (item.kind === "enum" || (item.kind === "duration" && item.choices?.length)) {
      return (
        <Select value={String(value ?? "")} onValueChange={(next) => onChange(next)} disabled={locked}>
          <SelectTrigger className="h-8 w-[168px] shrink-0" aria-label={item.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(item.choices ?? []).map((choice) => (
              <SelectItem key={choice} value={choice}>
                {item.kind === "duration" ? durationLabel(choice) : choice}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    const wide = item.kind === "text";
    const width = wide ? "w-[220px] md:w-[260px]" : bytes ? "w-[84px] md:w-[96px]" : "w-[132px] md:w-[168px]";
    return (
      <span className="flex items-center gap-1.5">
        <input
          type={item.kind === "int" || bytes ? "number" : "text"}
          value={bytes ? inMiB(value) : String(value ?? "")}
          disabled={locked}
          step={bytes ? "0.5" : undefined}
          min={bytes ? 0.001 : item.min}
          max={bytes && item.max ? item.max / MIB : item.max}
          aria-label={item.label}
          aria-invalid={error ? true : undefined}
          placeholder={item.key === "share_base" ? "the request's own origin" : undefined}
          onChange={(event) => {
            if (bytes) {
              onChange(Math.round((Number(event.target.value) || 0) * MIB));
              return;
            }
            onChange(item.kind === "int" ? Number(event.target.value) : event.target.value);
          }}
          className={`${field} ${width} ${error ? "border-[var(--destructive)]" : "border-[var(--border-strong)]"}`}
        />
        {bytes ? <span className="text-[11px] text-[var(--text-3)]">MiB</span> : null}
        {!bytes && item.unit ? <span className="text-[11px] text-[var(--text-3)]">{item.unit}</span> : null}
      </span>
    );
  };

  /** Where the value in force comes from, and the one action the row offers. */
  const marker = locked ? (
    <span className="flex shrink-0 items-center">
      <code className="border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10.5px] tracking-[0.02em] text-[var(--text-2)]">
        {item.env}
      </code>
      <InfoTip
        text={lockReason(item)}
        label={`Why ${item.label.toLowerCase()} is locked`}
        className="-mr-1.5"
      />
    </span>
  ) : atDefault ? (
    <span className={`${MARKER} text-[var(--text-3)]`}>Default</span>
  ) : (
    <button
      type="button"
      onClick={onReset}
      title={`Back to ${defaultLabel(item)} — the built-in default`}
      aria-label={`Reset ${item.label} to ${defaultLabel(item)}`}
      className={`${MARKER} inline-flex h-6 shrink-0 cursor-pointer items-center border border-[var(--border-strong)] bg-[var(--surface)] px-1.5 text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]`}
    >
      Reset
    </button>
  );

  return (
    <div
      data-field={item.key}
      className="grid gap-2 border-b border-[var(--border)] px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6"
    >
      <div className="grid gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--foreground)]">
          {item.label}
          {locked ? <Lock size={14} aria-hidden="true" className="text-[var(--text-3)]" /> : null}
        </span>
        <span className="text-xs leading-snug text-[var(--text-2)]">{item.description}</span>
        {error ? (
          <span role="alert" className="flex items-start gap-1.5 text-[11.5px] text-[var(--destructive)]">
            <Warning size={12} aria-hidden="true" className="mt-px shrink-0" />
            {error}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-start gap-x-3 gap-y-2 md:flex-nowrap md:justify-end md:pl-4">
        {control()}
        {/* A locked row carries two pieces of provenance (the variable and its rule): on a phone that is a
            line of its own, consistently, instead of wrapping only where the variable name is long. */}
        <span
          className={`flex shrink-0 items-center gap-2 ${locked ? "max-md:basis-full" : ""}`}
        >
          {dirty ? (
            <span className="border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-2)]">
              unsaved
            </span>
          ) : null}
          {marker}
        </span>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const live = useLive();

  const [base, setBase] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // A fresh payload from the server is the new baseline; an open draft survives a live event only if
  // the person has not touched it.
  useEffect(() => {
    if (!list.data) return;
    const next = valuesOf(list.data.items);
    setBase(next);
    setDraft((current) => current ?? next);
  }, [list.data]);

  useEffect(() => {
    if (live.last?.type === "settings") void list.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.last]);

  const items = list.data?.items ?? [];
  const changed = useMemo(() => {
    if (!draft || !base) return [] as string[];
    return Object.keys(draft).filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(base[key]));
  }, [draft, base]);

  // What the page itself has moved away from a default. A locked row's value usually differs from the
  // default too (the environment set it), but it is not a change the page made, so it is not counted here.
  const fromDefault = useMemo(
    () =>
      items.filter(
        (item) => item.editable && item.source !== "env" && !item.boot && !isDefault(item, draft?.[item.key]),
      ).length,
    [items, draft],
  );

  const dirty = changed.length > 0;

  const set = (key: string, value: unknown) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  // Reset is an edit, not a write: it puts the default in the draft and leaves the row dirty with its
  // siblings untouched. Save is the only thing that talks to the server.
  const reset = (item: Setting) => set(item.key, item.default);

  const discard = () => {
    setDraft(base);
    setErrors({});
  };

  async function save() {
    if (!draft || !dirty || saving) return;
    setSaving(true);
    setErrors({});
    try {
      const patch = Object.fromEntries(changed.map((key) => [key, draft[key]]));
      const body = await api.saveSettings(patch);
      qc.setQueryData(["settings"], body);
      setBase(valuesOf(body.items));
      setDraft(valuesOf(body.items));
      void qc.invalidateQueries({ queryKey: ["config"] });
      toast(`${changed.length} ${changed.length === 1 ? "setting" : "settings"} saved`);
    } catch (error) {
      if (error instanceof ApiError && error.field) {
        setErrors({ [error.field]: error.message });
      } else {
        toast(error instanceof ApiError ? error.message : "Could not save");
      }
    } finally {
      setSaving(false);
    }
  }

  const pinned = items.filter((item) => item.source === "env").length;

  return (
    <PageContainer className="py-7">
      <AppBack fallbackHref="/" fallbackLabel="Back to the composer" />
      <PageHead
        eyebrow="This deployment"
        title="Settings"
        meta={
          <>
            {dirty ? (
              <>
                <span>{changed.length} unsaved</span>
                <MetaDot />
              </>
            ) : null}
            <span>{fromDefault} changed here</span>
            <MetaDot />
            <span>{pinned} from the environment</span>
          </>
        }
      />

      {list.isLoading ? (
        <div className="grid gap-4">
          <div className="h-40 border border-[var(--border)] bg-[var(--surface-2)]" />
          <div className="h-40 border border-[var(--border)] bg-[var(--surface-2)]" />
        </div>
      ) : list.isError ? (
        <p className="text-sm text-[var(--destructive)]">The settings could not be loaded.</p>
      ) : (
        <div className="grid gap-6 pb-20">
          {(list.data?.groups ?? []).map((group) => {
            const rows = items.filter((item) => item.group === group);
            if (rows.length === 0) return null;
            const boot = rows.every((item) => item.boot);
            return (
              <section key={group} className="border border-[var(--border)] bg-[var(--surface)]">
                <header className="flex items-baseline justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                  <h2 className="m-0 text-sm font-semibold text-[var(--foreground)]">{group}</h2>
                  {boot ? (
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
                      Restart to change
                    </span>
                  ) : null}
                </header>
                {rows.map((item) => (
                  <Row
                    key={item.key}
                    item={item}
                    value={draft?.[item.key]}
                    onChange={(next) => set(item.key, next)}
                    error={errors[item.key]}
                    dirty={changed.includes(item.key)}
                    onReset={() => reset(item)}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}

      {dirty ? (
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] md:mx-0">
          <span className="text-[11px] tabular-nums text-[var(--text-2)]" aria-live="polite">
            {changed.length} unsaved {changed.length === 1 ? "change" : "changes"}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={discard}
              className="inline-flex h-8 cursor-pointer items-center border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex h-8 cursor-pointer items-center gap-2 bg-[var(--primary)] px-3 text-sm font-medium text-[var(--primary-foreground)] hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </span>
        </div>
      ) : null}
    </PageContainer>
  );
}
