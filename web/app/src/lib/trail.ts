/**
 * The tab's own trail. A single-page app has no referrer, so "back" can only mean one thing: the
 * entry the browser would return to. That is a stack with a cursor, not a list searched for
 * "anything other than here" — the search is what let Back bounce between a paste and its editor
 * (each page was the other's only non-self entry, forever).
 */
export type Trail = { list: string[]; at: number };

export const LIMIT = 24;

export const EMPTY_TRAIL: Trail = { list: [], at: -1 };

/** One route change. `replace` is a navigation that must overwrite the entry it came from. */
export function advance(trail: Trail, path: string, replace = false): Trail {
  const { list, at } = trail;
  if (at >= 0 && list[at] === path) return trail;
  if (replace) return push(list.slice(0, Math.max(at, 0)), path);
  // A route the cursor already sits next to is history moving, not a new destination: a back click
  // steps the cursor back, a forward click steps it on. Anything else starts a new branch.
  if (at > 0 && list[at - 1] === path) return { list, at: at - 1 };
  if (at >= 0 && at < list.length - 1 && list[at + 1] === path) return { list, at: at + 1 };
  return push(list.slice(0, at + 1), path);
}

/** Where Back goes: exactly one step back, or nothing when the trail starts here. */
export function backTarget(trail: Trail): string | null {
  return trail.at > 0 ? trail.list[trail.at - 1] : null;
}

function push(list: string[], path: string): Trail {
  const appended = [...list, path];
  // Two consecutive entries with the same URL are one place — a replace after a save, or a page
  // revisited — and neither deserves a back step that lands where you already are.
  const deduped =
    appended.length > 1 && appended[appended.length - 2] === path ? appended.slice(0, -1) : appended;
  const next = deduped.slice(-LIMIT);
  return { list: next, at: next.length - 1 };
}

/** Anything stored before the cursor existed was a bare array; ignore it rather than misread it. */
export function parseTrail(raw: string | null): Trail {
  if (!raw) return EMPTY_TRAIL;
  try {
    const parsed = JSON.parse(raw) as Trail;
    if (!parsed || !Array.isArray(parsed.list) || typeof parsed.at !== "number") return EMPTY_TRAIL;
    const list = parsed.list.filter((entry): entry is string => typeof entry === "string");
    const at = Math.max(-1, Math.min(parsed.at, list.length - 1));
    return { list, at };
  } catch {
    return EMPTY_TRAIL;
  }
}
