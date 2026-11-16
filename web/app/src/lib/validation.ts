import type { DraftState } from "@/hooks/use-draft";

/**
 * The same four rules the API enforces, so the composer fails before the request. The field names are
 * the API's own tokens: an error from the server can be dropped straight into the same list.
 */
export type FieldName = "text" | "visibility" | "expiry" | "password" | "max_views" | "burn";

export type FieldError = { field: FieldName; message: string };

export function validateDraft(draft: DraftState): FieldError[] {
  const errors: FieldError[] = [];
  const hasBody = draft.text.trim() !== "" || draft.files.length > 0;

  if (!hasBody) {
    errors.push({ field: "text", message: "There is nothing to save yet." });
  }
  if (draft.visibility === "public") {
    if (draft.expiresIn <= 0) {
      errors.push({ field: "expiry", message: "A public paste must expire." });
    }
    if (draft.burn) {
      errors.push({ field: "burn", message: "A public paste cannot burn." });
    }
    if (!draft.clearPassword && draft.password !== "" && draft.password.length < 8) {
      errors.push({ field: "password", message: "Use at least 8 characters." });
    }
    if (!Number.isInteger(draft.maxViews) || draft.maxViews < 0) {
      errors.push({ field: "max_views", message: "Use a whole number, or leave it empty." });
    }
  }
  return errors;
}
