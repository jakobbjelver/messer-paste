import type { Setting } from "@/api";

/**
 * Byte counts are read in 1024 steps labelled B/KB/MB/GB — the same scale and the same labels
 * `lib/format.ts` prints paste sizes in, so a 2 MiB cap reads "2 MB" everywhere in the app.
 */
const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;
export type ByteUnit = (typeof BYTE_UNITS)[number];

export const UNIT_BYTES: Record<ByteUnit, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
};

/** The unit a byte count is easiest to read in. */
export function byteUnit(bytes: unknown): ByteUnit {
  let n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) n = 0;
  let i = 0;
  while (n >= 1024 && i < BYTE_UNITS.length - 1) {
    n /= 1024;
    i += 1;
  }
  return BYTE_UNITS[i];
}

/** A byte count as the number a field showing `unit` holds, without trailing zeros. */
export function byteValue(bytes: unknown, unit: ByteUnit): string {
  const n = Number(bytes) / UNIT_BYTES[unit];
  if (!Number.isFinite(n)) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * A duration in the words the row's own options use: "24h" is a label, not a number. Anything the
 * pattern does not know is printed as it came.
 */
export function durationLabel(raw: string): string {
  if (raw === "0") return "never";
  const match = /^(\d+)([hdw])$/.exec(raw);
  if (!match) return raw;
  const [, n, unit] = match;
  const word = unit === "h" ? "hour" : unit === "d" ? "day" : "week";
  return `${n} ${Number(n) === 1 ? word : `${word}s`}`;
}

/** The draft and the catalog speak JSON: numbers, bools and strings compare by their JSON form. */
export function isDefault(item: Pick<Setting, "default">, value: unknown): boolean {
  return JSON.stringify(value ?? null) === JSON.stringify(item.default ?? null);
}

/** The default in the row's own words: "2 MB", "24 hours", "on", "empty", "1h,24h,7d,0". */
export function defaultLabel(item: Pick<Setting, "kind" | "unit" | "default">): string {
  if (item.unit === "bytes") {
    const unit = byteUnit(item.default);
    return `${byteValue(item.default, unit)} ${unit}`;
  }
  if (item.kind === "duration") return durationLabel(String(item.default));
  if (item.kind === "bool") return item.default ? "on" : "off";
  const raw = String(item.default ?? "");
  return raw === "" ? "empty" : raw;
}

/**
 * Why a row cannot be edited here. The variable's name is in the code box beside the tip; the tip
 * carries the rule, because a bare name says where a value comes from and not why it is stuck.
 */
export function lockReason(item: Pick<Setting, "boot" | "env">): string {
  if (item.boot) {
    return `${item.env} is read when the process starts and never changes after. Restart the container to change it.`;
  }
  return `Set by ${item.env} in the environment, so it cannot be changed here. Remove the variable and restart to edit the value.`;
}

/**
 * The unit a byte row edits in. It follows the value the server holds — and the default when the row
 * sits at it — never the keystroke in flight: a field that relabelled itself to "B" the moment it was
 * cleared would silently change what the next digit means. Reset, Discard and Save move that baseline,
 * so a 2048 MB edit comes back as 2 GB.
 */
export function rowUnit(item: Pick<Setting, "unit" | "default">, value: unknown, saved: unknown): ByteUnit | undefined {
  if (item.unit !== "bytes") return undefined;
  const held = isDefault(item, value) ? item.default : saved ?? item.default;
  return byteUnit(held);
}
