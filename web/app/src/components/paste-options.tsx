import { useState, type ReactNode } from "react";
import {
  Eye,
  EyeSlash,
  Infinity as InfinityIcon,
  Sparkle,
  Warning,
} from "@phosphor-icons/react";
import { toast } from "sonner";

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
import { generatePassword } from "@/lib/password";
import type { FieldError } from "@/lib/validation";
import type { DraftState } from "@/hooks/use-draft";

const EXPIRY = [
  { value: 3600, label: "1h" },
  { value: 86_400, label: "24h" },
  { value: 604_800, label: "7d" },
  { value: 0, label: null },
];

function Section({
  label,
  children,
  tip,
  error,
}: {
  label: string;
  children: ReactNode;
  tip?: ReactNode;
  error?: string;
}) {
  return (
    <section className="grid gap-2.5 border-b border-[var(--border)] px-4 py-4">
      <span className="flex items-center gap-1">
        <span className="m-label">{label}</span>
        {tip ? <InfoTip text={tip} label={`About ${label.toLowerCase()}`} /> : null}
      </span>
      {children}
      {error ? (
        <p
          className="m-0 flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--destructive)]"
          role="alert"
        >
          <Warning size={13} aria-hidden="true" className="mt-px shrink-0" />
          {error}
        </p>
      ) : null}
    </section>
  );
}

const FIELD =
  "h-8 w-full border bg-[var(--surface)] px-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--text-3)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]";

export function PasteOptions({
  draft,
  set,
  detected,
  pending,
  ctaLabel,
  ctaIcon,
  onSubmit,
  onClearFiles,
  locked,
  errors = [],
}: {
  draft: DraftState;
  set: (patch: Partial<DraftState>) => void;
  detected: LanguageId;
  pending: boolean;
  ctaLabel: string;
  ctaIcon?: ReactNode;
  onSubmit: () => void;
  onClearFiles: () => void;
  /** The stored paste has a password. Only the owner sees this, and never the password itself. */
  locked?: boolean;
  errors?: FieldError[];
}) {
  const [reveal, setReveal] = useState(false);
  const fileBytes = draft.files.reduce((total, file) => total + file.size, 0);
  const expiresAt =
    draft.expiresIn > 0 ? Math.round(Date.now() / 1000) + draft.expiresIn : null;
  const errorFor = (field: FieldError["field"]) =>
    errors.find((entry) => entry.field === field)?.message;

  const generate = () => {
    const password = generatePassword(16);
    set({ password, clearPassword: false });
    void navigator.clipboard
      ?.writeText(password)
      .then(() => toast("Password generated and copied"))
      .catch(() => toast("Password generated"));
  };

  return (
    <aside className="flex min-h-0 flex-col border-t border-[var(--border)] lg:border-l lg:border-t-0">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {draft.files.length > 0 ? (
          <Section label="Files">
            <div className="flex h-8 items-center justify-between gap-2 border border-[var(--border-strong)] bg-[var(--surface)] px-2.5">
              <span className="truncate text-xs tabular-nums text-[var(--text-2)]">
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
          <span className="text-[10.5px] tabular-nums text-[var(--text-3)]">
            {draft.language === "auto"
              ? `detected ${languageLabel(detected)}`
              : languageLabel(draft.language)}
          </span>
        </Section>

        <Section
          label="Visibility"
          tip="Private is only reachable through your own access layer. Public is readable by anyone with the link, on the public host: it must expire, and it cannot burn."
          error={errorFor("visibility")}
        >
          <div className="grid grid-cols-2 border border-[var(--border-strong)]">
            {(["private", "public"] as const).map((value) => (
              <button
                key={value}
                type="button"
                data-field="visibility"
                aria-pressed={draft.visibility === value}
                onClick={() =>
                  set(
                    value === "public"
                      ? { visibility: value, expiresIn: draft.expiresIn || 86_400, burn: false }
                      : { visibility: value },
                  )
                }
                className={`relative grid h-8 cursor-pointer place-items-center border-r border-[var(--border-strong)] text-[11px] font-medium uppercase tracking-[0.06em] last:border-r-0 ${
                  draft.visibility === value
                    ? "bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] text-[var(--foreground)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[var(--primary)] after:content-['']"
                    : "bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]"
                }`}
              >
                {value === "private" ? "Private" : "Public"}
              </button>
            ))}
          </div>

          {draft.visibility === "public" ? (
            <>
              {/* A <div>, not a <label>: a label activates its first labelable descendant, which was the
                  Generate button — so a tap on the eye regenerated the password on iOS. */}
              <div className="grid gap-1">
                <label
                  htmlFor="paste-password"
                  className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]"
                >
                  Password
                </label>
                <div className="flex h-8 w-full min-w-0 items-center border border-[var(--border-strong)] bg-[var(--surface)] focus-within:outline-solid focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-[var(--ring)]">
                  <button
                    type="button"
                    onClick={generate}
                    aria-label="Generate a password"
                    className="flex h-full shrink-0 cursor-pointer items-center gap-1 border-r border-[var(--border)] px-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                  >
                    <Sparkle size={11} aria-hidden="true" />
                    Generate
                  </button>
                  <input
                    id="paste-password"
                    type={reveal ? "text" : "password"}
                    data-field="password"
                    value={draft.password}
                    autoComplete="new-password"
                    aria-invalid={errorFor("password") ? true : undefined}
                    placeholder={
                      locked ? "Set a new one, or keep the current" : "Optional · 8+ characters"
                    }
                    onChange={(event) =>
                      set({ password: event.target.value, clearPassword: false })
                    }
                    className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-sm text-[var(--foreground)] outline-none placeholder:font-sans placeholder:text-[var(--text-3)]"
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((was) => !was)}
                    aria-label={reveal ? "Hide password" : "Show password"}
                    aria-pressed={reveal}
                    className="grid size-7 shrink-0 cursor-pointer place-items-center text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                  >
                    {reveal ? (
                      <EyeSlash size={14} aria-hidden="true" />
                    ) : (
                      <Eye size={14} aria-hidden="true" />
                    )}
                  </button>
                </div>
                {errorFor("password") ? (
                  <span
                    role="alert"
                    className="flex items-start gap-1.5 text-[11.5px] text-[var(--destructive)]"
                  >
                    <Warning size={13} aria-hidden="true" className="mt-px shrink-0" />
                    {errorFor("password")}
                  </span>
                ) : null}
              </div>
              <label className="grid gap-1">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-[var(--text-3)]">
                  Reader limit
                </span>
                <input
                  type="number"
                  min={0}
                  data-field="max_views"
                  value={draft.maxViews === 0 ? "" : draft.maxViews}
                  placeholder="No limit"
                  aria-invalid={errorFor("max_views") ? true : undefined}
                  onChange={(event) =>
                    set({ maxViews: Math.max(0, Number(event.target.value) || 0) })
                  }
                  className={`${FIELD} ${
                    errorFor("max_views")
                      ? "border-[var(--destructive)]"
                      : "border-[var(--border-strong)]"
                  }`}
                />
                {errorFor("max_views") ? (
                  <span
                    role="alert"
                    className="flex items-start gap-1.5 text-[11.5px] text-[var(--destructive)]"
                  >
                    <Warning size={13} aria-hidden="true" className="mt-px shrink-0" />
                    {errorFor("max_views")}
                  </span>
                ) : null}
              </label>
              {locked ? (
                <button
                  type="button"
                  onClick={() => set({ clearPassword: true, password: "" })}
                  className="h-7 cursor-pointer justify-self-start px-1.5 text-xs text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                >
                  {draft.clearPassword ? "Password will be removed" : "Remove password"}
                </button>
              ) : null}
            </>
          ) : null}
        </Section>

        <Section label="Expires" error={errorFor("expiry")}>
          <div className="grid grid-cols-4 border border-[var(--border-strong)]">
            {EXPIRY.map((option) => (
              <button
                key={option.value}
                type="button"
                data-field="expiry"
                aria-pressed={draft.expiresIn === option.value}
                aria-label={option.label ?? "Never expires"}
                disabled={draft.visibility === "public" && option.value === 0}
                onClick={() => set({ expiresIn: option.value })}
                className={`relative grid h-8 cursor-pointer place-items-center border-r border-[var(--border-strong)] text-[11px] font-medium uppercase tracking-[0.06em] last:border-r-0 disabled:cursor-not-allowed disabled:opacity-40 ${
                  draft.expiresIn === option.value
                    ? "bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] text-[var(--foreground)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[var(--primary)] after:content-['']"
                    : "bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)]"
                }`}
              >
                {option.label ?? <InfinityIcon size={14} aria-hidden="true" />}
              </button>
            ))}
          </div>
          <span className="text-[10.5px] tabular-nums text-[var(--text-3)]">
            {expiresAt ? `until ${absolute(expiresAt)}` : "kept until deleted"}
          </span>
        </Section>

        <Section
          label="Burn after reading"
          tip="Opening the paste consumes it: the text and files are deleted on the first reveal, on every device."
          error={errorFor("burn")}
        >
          <label
            className={`flex h-8 items-center gap-2 text-sm ${
              draft.visibility === "public"
                ? "cursor-not-allowed text-[var(--text-3)]"
                : "cursor-pointer text-[var(--foreground)]"
            }`}
          >
            <Switch
              data-field="burn"
              checked={draft.burn}
              disabled={draft.visibility === "public"}
              onCheckedChange={(burn) => set({ burn })}
              aria-label="Burn after reading"
            />
            One read, then gone
          </label>
          {draft.visibility === "public" ? (
            <p className="m-0 text-[11px] leading-snug text-[var(--text-3)]">
              A public paste has to expire, so burning is off. Switch to private to use it.
            </p>
          ) : null}
        </Section>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-[var(--border)] bg-[var(--surface)] p-4 pb-[calc(16px+env(safe-area-inset-bottom))] lg:static lg:bg-transparent lg:pb-4">
        <button
          type="button"
          id="commit"
          disabled={pending || (!draft.text.trim() && draft.files.length === 0)}
          onClick={onSubmit}
          className="flex h-9 w-full cursor-pointer items-center justify-center gap-2 bg-[var(--primary)] px-2.5 sm:justify-start text-sm font-medium text-[var(--primary-foreground)] transition-colors duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:border disabled:border-[var(--border-strong)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-3)]"
        >
          {!pending && ctaIcon ? (
            <span aria-hidden="true" className="shrink-0">
              {ctaIcon}
            </span>
          ) : null}
          <span className="truncate">{pending ? "Saving…" : ctaLabel}</span>
          {!pending ? (
            <span className="ml-auto hidden shrink-0 items-center gap-1 sm:flex" aria-hidden="true">
              <kbd className="m-kbd m-kbd--tight m-kbd--inherit">{modKey()}</kbd>
              <kbd className="m-kbd m-kbd--tight m-kbd--inherit">{enterKey()}</kbd>
            </span>
          ) : null}
        </button>
      </div>
    </aside>
  );
}
