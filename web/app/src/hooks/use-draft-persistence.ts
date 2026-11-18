import { useCallback, useEffect, useRef } from "react";

import type { DraftState } from "@/hooks/use-draft";
import { draftFromStored, storedFromDraft } from "@/lib/draft-serialize";
import { clearDraft, isBlank, readDraft, shouldHydrate, writeDraft } from "@/lib/draft-store";

/**
 * Mirrors the composer's draft into IndexedDB so a discarded tab, a reload, or an hour in the
 * background does not take the uploaded file with it.
 *
 * Order matters twice: nothing is written until the read has settled (an empty first render must not
 * erase the stored draft), and nothing is written after `clear()` (a save has handed the draft to the
 * server, and a flush on unmount must not resurrect it).
 */
export function useDraftPersistence({
  key,
  draft,
  serverUpdatedAt,
  onHydrate,
  enabled = true,
}: {
  key: string;
  draft: DraftState;
  /** The row this draft edits, in unix seconds. Absent for a new paste. */
  serverUpdatedAt?: number;
  onHydrate: (state: DraftState) => void;
  /** Off for a duplicate: that draft was composed from another paste, not by the person. */
  enabled?: boolean;
}) {
  const settled = useRef(false);
  const disabled = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;

  const flush = useCallback(() => {
    if (!enabled || !settled.current || disabled.current) return;
    const record = storedFromDraft(key, latest.current);
    if (isBlank(record)) {
      void clearDraft(key);
      return;
    }
    void writeDraft(record);
  }, [enabled, key]);

  useEffect(() => {
    settled.current = false;
    disabled.current = false;
    if (!enabled) return;
    let cancelled = false;
    void readDraft(key).then((stored) => {
      if (cancelled || !stored) {
        settled.current = true;
        return;
      }
      if (shouldHydrate(stored, Date.now(), serverUpdatedAt)) onHydrate(draftFromStored(stored));
      settled.current = true;
    });
    return () => {
      cancelled = true;
    };
    // The server's row only matters at mount: a refetch is not a reason to reconsider the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  // Debounced write: a keystroke should not be a transaction.
  useEffect(() => {
    if (!settled.current) return;
    const timer = window.setTimeout(flush, 400);
    return () => window.clearTimeout(timer);
  }, [draft, flush]);

  // A phone can be closed at any moment; pagehide is the last event we are promised.
  useEffect(() => {
    const handler = () => flush();
    window.addEventListener("pagehide", handler);
    return () => {
      window.removeEventListener("pagehide", handler);
      flush();
    };
  }, [flush]);

  /** The draft is now the server's (saved) or the paste's (deleted): stop mirroring it. */
  const clear = useCallback(() => {
    disabled.current = true;
    void clearDraft(key);
  }, [key]);

  return { clear };
}
