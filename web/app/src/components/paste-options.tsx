import type { ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/switch";
import { LANGUAGES, languageLabel, type LanguageId } from "@/lib/language";
import { absolute } from "@/lib/format";
import type { DraftState } from "@/hooks/use-draft";

const EXPIRY = [
  { value: 3600, label: "1h" },
  { value: 86_400, label: "24h" },
  { value: 604_800, label: "7d" },
  { value: 0, label: "∞" },
];

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="grid gap-2.5 border-b border-[var(--border)] px-4 py-4">
      <span className="m-label">{label}</span>
      {children}
    </section>
  );
}

export function PasteOptions({
  draft,
  set,
  mediaOnly,
  detected,
  pending,
  ctaLabel,
  hint,
  onSubmit,
  onClearFiles,
}: {
  draft: DraftState;
  set: (patch: Partial<DraftState>) => void;
  mediaOnly: boolean;
  detected: LanguageId;
  pending: boolean;
  ctaLabel: string;
  hint: string;
  onSubmit: () => void;
  onClearFiles: () => void;
}) {
  const fileBytes = draft.files.reduce((total, file) => total + file.size, 0);
  const expiresAt =
    draft.expiresIn > 0 ? Math.round(Date.now() / 1000) + draft.expiresIn : null;

  return (
    <aside className="flex min-h-0 flex-col border-t border-[var(--border)] lg:border-l lg:border-t-0">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mediaOnly ? (
          <Section label="Files">
            <div className="flex h-8 items-center justify-between gap-2 border border-[var(--border-strong)] bg-[var(--surface)] px-2.5">
              <span className="truncate font-mono text-xs text-[var(--text-2)]">
                {draft.files.length} {draft.files.length === 1 ? "file" : "files"} ·{" "}
                {fileBytes > 1024 * 1024
                  ? `${(fileBytes / 1024 / 1024).toFixed(1)} MB`
                  : `${Math.max(1, Math.round(fileBytes / 1024))} KB`}
              </span>
              <button
                type="button"
                onClick={onClearFiles}
                className="h-7 cursor-pointer px-1.5 text-xs text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
              >
                Clear
              </button>
            </div>
          </Section>
        ) : (
          <Section label="Language">
            <Select
              value={draft.language}
              onValueChange={(value) => set({ language: value as LanguageId })}
            >
              <SelectTrigger aria-label="Language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((language) => (
                  <SelectItem key={language.id} value={language.id}>
                    {language.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="font-mono text-[10.5px] text-[var(--text-3)]">
              {draft.language === "auto"
                ? `detected ${languageLabel(detected)}`
                : languageLabel(draft.language)}
            </span>
          </Section>
        )}

        <Section label="Expires">
          <div className="grid grid-cols-4 border border-[var(--border-strong)]">
            {EXPIRY.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={draft.expiresIn === option.value}
                onClick={() => set({ expiresIn: option.value })}
                className={`relative h-8 cursor-pointer border-r border-[var(--border-strong)] font-mono text-[11px] uppercase tracking-[0.1em] last:border-r-0 ${
                  draft.expiresIn === option.value
                    ? "bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] text-[var(--foreground)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[var(--primary)] after:content-['']"
                    : "bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="font-mono text-[10.5px] text-[var(--text-3)]">
            {expiresAt ? `until ${absolute(expiresAt)}` : "kept until deleted"}
          </span>
        </Section>

        <Section label="Burn after reading">
          <Switch
            checked={draft.burn}
            onChange={(burn) => set({ burn })}
            label="One read, then gone"
            hint="Opening the paste consumes it, on every device."
          />
        </Section>

        <Section label="Shortcuts">
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-2)]">
                {ctaLabel === "Save changes" ? "Save" : "Create"}
              </span>
              <span className="flex gap-1">
                <kbd className="m-kbd">⌘</kbd>
                <kbd className="m-kbd">⏎</kbd>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-2)]">Search pastes</span>
              <span className="flex gap-1">
                <kbd className="m-kbd">⌘</kbd>
                <kbd className="m-kbd">K</kbd>
              </span>
            </div>
          </div>
        </Section>
      </div>

      <div className="grid gap-2 border-t border-[var(--border)] p-4">
        <button
          type="button"
          id="commit"
          disabled={pending || (!draft.text.trim() && draft.files.length === 0)}
          onClick={onSubmit}
          className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 bg-[var(--primary)] px-4 text-sm font-medium text-[var(--primary-fg)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:border disabled:border-[var(--border-strong)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-3)]"
        >
          {pending ? "Saving…" : ctaLabel}
        </button>
        <span className="text-center font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
          {hint}
        </span>
      </div>
    </aside>
  );
}
