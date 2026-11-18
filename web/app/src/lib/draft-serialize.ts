import type { DraftFile, DraftState } from "@/hooks/use-draft";
import type { LanguageId } from "@/lib/language";

import { trimBlobs, type StoredDraft, type StoredFile } from "./draft-store";

/**
 * Between the reducer's draft and the record IndexedDB keeps. Kept out of both so it can be tested
 * without a browser: `createUrl` is the only DOM call, and the caller passes it in.
 */
export function storedFromDraft(key: string, draft: DraftState, now = Date.now()): StoredDraft {
  return {
    key,
    savedAt: now,
    title: draft.title,
    text: draft.text,
    language: draft.language,
    expiresIn: draft.expiresIn,
    burn: draft.burn,
    visibility: draft.visibility,
    maxViews: draft.maxViews,
    files: trimBlobs(
      draft.files.map<StoredFile>((file) =>
        file.file
          ? { name: file.name, mime: file.mime, size: file.size, blob: file.file }
          : { name: file.name, mime: file.mime, size: file.size, id: file.id },
      ),
    ),
  };
}

export function draftFromStored(
  stored: StoredDraft,
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
): DraftState {
  return {
    title: stored.title,
    text: stored.text,
    language: stored.language as LanguageId,
    expiresIn: stored.expiresIn,
    burn: stored.burn,
    visibility: stored.visibility,
    password: "",
    clearPassword: false,
    maxViews: stored.maxViews,
    files: stored.files.map<DraftFile>((file, index) => {
      if (file.id) {
        return { key: `srv-${file.id}`, id: file.id, name: file.name, mime: file.mime, size: file.size };
      }
      const blob = file.blob ?? new Blob([], { type: file.mime });
      return {
        key: `new-${stored.savedAt}-${index}`,
        name: file.name,
        mime: file.mime,
        size: file.size,
        file: new File([blob], file.name, { type: file.mime }),
        url: file.mime.startsWith("image/") ? createUrl(blob) : undefined,
      };
    }),
  };
}
