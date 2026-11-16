/** The canon switch recipe: square track, `--background` knob, only the track changes. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="grid cursor-pointer gap-1">
      <span className="flex items-center gap-2 text-sm text-[var(--foreground)]">
        <input
          type="checkbox"
          className="m-switch"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </span>
      {hint ? <span className="text-xs text-[var(--text-3)]">{hint}</span> : null}
    </label>
  );
}
