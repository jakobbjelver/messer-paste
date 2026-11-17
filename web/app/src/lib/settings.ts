import type { Setting } from "@/api";

/** Bytes are for machines: a person sets this in MiB. */
export const MIB = 1024 * 1024;

/** The byte count a row edits, printed in MiB without a trailing `.00`. */
export function inMiB(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return "";
  const mib = n / MIB;
  return Number.isInteger(mib) ? String(mib) : mib.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
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

/** The default in the row's own words: "2 MiB", "24 hours", "on", "empty", "1h,24h,7d,0". */
export function defaultLabel(item: Pick<Setting, "kind" | "unit" | "default">): string {
  if (item.unit === "bytes") return `${inMiB(item.default)} MiB`;
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
