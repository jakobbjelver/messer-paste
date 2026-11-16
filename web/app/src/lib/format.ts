const UNITS = ["B", "KB", "MB", "GB"];

export function bytes(n: number): string {
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}

export function ago(ts: number, now = Date.now()): string {
  const secs = Math.max(0, Math.round(now / 1000 - ts));
  if (secs < 45) return "now";
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86_400) return `${Math.round(secs / 3600)}h`;
  if (secs < 604_800) return `${Math.round(secs / 86_400)}d`;
  return `${Math.round(secs / 604_800)}w`;
}

export function remaining(expiresAt: number | null, now = Date.now()): string {
  if (!expiresAt) return "never";
  const secs = expiresAt - Math.round(now / 1000);
  if (secs <= 0) return "expired";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86_400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86_400)}d`;
}

export function expiringSoon(expiresAt: number | null, now = Date.now()): boolean {
  return expiresAt !== null && expiresAt - Math.round(now / 1000) < 2 * 3600;
}

export function absolute(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case "images":
      return "Images";
    case "files":
      return "Files";
    case "mixed":
      return "Mixed";
    default:
      return "Text";
  }
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
