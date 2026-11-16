import type { ReactNode } from "react";
import { Infinity as InfinityIcon } from "@phosphor-icons/react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { InfoTip } from "@/components/ui/info-tip";
import { LANGUAGES, languageLabel, type LanguageId } from "@/lib/language";
import { absolute } from "@/lib/format";
import { modKey, enterKey } from "@/lib/platform";
import type { DraftState } from "@/hooks/use-draft";

const EXPIRY = [
  { value: 3600, label: "1h" },
  { value: 86_400, label: "24h" },
  { value: 604_800, label: "7d" },
  { value: 0, label: null },
];

function Section({ label, children, tip }: { label: string; children: ReactNode; tip?: ReactNode }) {
  return (
    <section className="grid gap-2.5 border-b border-[var(--border)] px-4 py-4">
      <span className="flex items-center gap-1">
        <span className="m-label">{label}</span>
        {tip ? <InfoTip text={tip} label={`About ${label.toLowerCase()}`} /> : null}
      </span>
      {children}
    </section>
  );
}

export function PasteOptions({
  draft,
  set,
  detected,
  pending,
  ctaLabel,
  onSubmit,
  onClearFiles,
}: {
  draft: DraftState;
  set: (patch: Partial<DraftState>) => void;
  detected: LanguageId;
  pending: boolean;
  ctaLabel: string;
  onSubmit: () => void;
  onClearFiles: () => void;
}) {
  const fileBytes = draft.files.reduce((total, file) => total + file.size, 0);
  const expiresAt =
    draft.expiresIn > 0 ? Math.round(Date.now() / 1000) + draft.expiresIn : null;

  return (
    <aside className="flex min-h-0 flex-col border-t border-[var(--border)] lg:border-l lg:border-t-0">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {draft.files.length > 0 ? (
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
        ) : null}

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

        <Section label="Expires">
          <div className="grid grid-cols-4 border border-[var(--border-strong)]">
            {EXPIRY.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={draft.expiresIn === option.value}
                aria-label={option.label ?? "Never expires"}
                onClick={() => set({ expiresIn: option.value })}
                className={`relative grid h-8 cursor-pointer place-items-center border-r border-[var(--border-strong)] font-mono text-[11px] uppercase tracking-[0.1em] last:border-r-0 ${
                  draft.expiresIn === option.value
                    ? "bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] text-[var(--foreground)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[var(--primary)] after:content-['']"
                    : "bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]"
                }`}
              >
                {option.label ?? <InfinityIcon size={14} aria-hidden="true" />}
              </button>
            ))}
          </div>
          <span className="font-mono text-[10.5px] text-[var(--text-3)]">
            {expiresAt ? `until ${absolute(expiresAt)}` : "kept until deleted"}
          </span>
        </Section>

        <Section
          label="Burn after reading"
          tip="Opening the paste consumes it: the text and files are deleted on the first reveal, on every device."
        >
          <label className="flex h-8 cursor-pointer items-center gap-2 text-sm text-[var(--foreground)]">
            <Switch
              checked={draft.burn}
              onCheckedChange={(burn) => set({ burn })}
              aria-label="Burn after reading"
            />
            One read, then gone
          </label>
        </Section>
      </div>

      <div className="border-t border-[var(--border)] p-4">
        <button
          type="button"
          id="commit"
          disabled={pending || (!draft.text.trim() && draft.files.length === 0)}
          onClick={onSubmit}
          className="grid h-9 w-full cursor-pointer grid-cols-[1fr_auto_1fr] items-center gap-2 bg-[var(--primary)] px-2 text-sm font-medium text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:border disabled:border-[var(--border-strong)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-3)]"
        >
          <span aria-hidden="true" />
          <span className="truncate">{pending ? "Saving…" : ctaLabel}</span>
          {!pending ? (
            <span className="flex items-center justify-self-end" aria-hidden="true">
              <kbd className="m-kbd border-[color-mix(in_oklab,var(--primary-foreground)_28%,transparent)] bg-transparent text-[var(--primary-foreground)] opacity-80">
                {modKey()}
              </kbd>
              <kbd className="m-kbd -ml-px border-[color-mix(in_oklab,var(--primary-foreground)_28%,transparent)] bg-transparent text-[var(--primary-foreground)] opacity-80">
                {enterKey()}
              </kbd>
            </span>
          ) : (
            <span aria-hidden="true" />
          )}
        </button>
      </div>
    </aside>
  );
}
