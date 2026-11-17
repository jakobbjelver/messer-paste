import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";

import { api, ApiError, type Setting } from "@/api";
import { PageContainer } from "@/components/ui/page-container";
import { PageHead } from "@/components/page-head";
import { BackLink } from "@/components/ui/back-link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useLive } from "@/hooks/use-live-events";

/** The values a page edits: key → value, with the server's own shape preserved. */
type Draft = Record<string, unknown>;

function valuesOf(items: Setting[]): Draft {
  return Object.fromEntries(items.map((item) => [item.key, item.value]));
}

/**
 * One setting, one row: what it is on the left, the control and who set it on the right.
 *
 * A row the environment owns cannot be edited here, and says why with the variable's own name — the
 * name is the explanation, so there is no paragraph to read.
 */
function Row({
  item,
  value,
  onChange,
  error,
  dirty,
}: {
  item: Setting;
  value: unknown;
  onChange: (next: unknown) => void;
  error?: string;
  dirty?: boolean;
}) {
  const locked = !item.editable || item.source === "env" || item.boot;
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
    const wide = item.kind === "text" || item.kind === "list";
    return (
      <span className="flex items-center gap-1.5">
        <input
          type={item.kind === "int" ? "number" : "text"}
          value={String(value ?? "")}
          disabled={locked}
          min={item.min}
          max={item.max}
          aria-label={item.label}
          aria-invalid={error ? true : undefined}
          onChange={(event) =>
            onChange(item.kind === "int" ? Number(event.target.value) : event.target.value)
          }
          className={`h-8 ${wide ? "w-[260px]" : "w-[168px]"} border bg-[var(--surface)] px-2 text-sm tabular-nums text-[var(--foreground)] outline-none placeholder:text-[var(--text-3)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--text-3)] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
            error ? "border-[var(--destructive)]" : "border-[var(--border-strong)]"
          }`}
        />
        {item.unit ? <span className="text-[11px] text-[var(--text-3)]">{item.unit}</span> : null}
      </span>
    );
  };

  return (
    <div
      data-field={item.key}
      className="grid gap-2 border-b border-[var(--border)] px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6"
    >
      <div className="grid gap-0.5">
        <span className="flex items-center gap-1.5 text-sm text-[var(--foreground)]">
          {item.label}
          {locked ? (
            <Lock size={11} aria-hidden="true" className="text-[var(--text-3)]" />
          ) : null}
        </span>
        <span className="text-xs leading-snug text-[var(--text-2)]">{item.description}</span>
        {error ? (
          <span role="alert" className="flex items-start gap-1.5 text-[11.5px] text-[var(--destructive)]">
            <Warning size={12} aria-hidden="true" className="mt-px shrink-0" />
            {error}
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 md:justify-end md:pl-4">
        {control()}
        <span className="w-[132px] shrink-0 text-right">
          {dirty ? (
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--foreground)]">Unsaved</span>
          ) : item.source === "env" || item.boot ? (
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
              {item.env}
            </span>
          ) : item.source === "custom" ? (
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-2)]">Custom</span>
          ) : (
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">Default</span>
          )}
        </span>
      </div>
    </div>
  );
}

function durationLabel(raw: string): string {
  if (raw === "0") return "never";
  const match = /^(\d+)([hdw])$/.exec(raw);
  if (!match) return raw;
  const [, n, unit] = match;
  const word = unit === "h" ? "hour" : unit === "d" ? "day" : "week";
  return `${n} ${Number(n) === 1 ? word : `${word}s`}`;
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

  const dirty = changed.length > 0;

  const set = (key: string, value: unknown) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

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
  const custom = items.filter((item) => item.source === "custom").length;

  return (
    <PageContainer className="py-7">
      <BackLink href="/" label="Back to the composer" className="mb-4" />
      <PageHead
        eyebrow="Settings"
        title="Settings"
        meta={
          dirty ? (
            <>
              <span>{changed.length} unsaved</span>
              <span aria-hidden="true">·</span>
              <span>{custom} custom</span>
            </>
          ) : (
            <>
              <span>{custom} changed</span>
              <span aria-hidden="true">·</span>
              <span>{pinned} from the environment</span>
            </>
          )
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
