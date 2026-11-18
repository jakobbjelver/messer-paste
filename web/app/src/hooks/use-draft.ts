import { useCallback, useMemo, useReducer } from "react";

import type { LanguageId } from "@/lib/language";
import type { PasteDetail } from "@/api";

export type DraftFile = {
  key: string;
  id?: string;
  name: string;
  mime: string;
  size: number;
  file?: File;
  url?: string;
};

export type DraftState = {
  title: string;
  text: string;
  language: LanguageId;
  expiresIn: number;
  burn: boolean;
  visibility: "private" | "public";
  /** Empty means "keep the stored password" when editing, and "no password" when creating. */
  password: string;
  clearPassword: boolean;
  maxViews: number;
  files: DraftFile[];
};

export const EMPTY: DraftState = {
  title: "",
  text: "",
  language: "auto",
  expiresIn: 86_400,
  burn: false,
  visibility: "private",
  password: "",
  clearPassword: false,
  maxViews: 0,
  files: [],
};

type Action =
  | { type: "patch"; patch: Partial<DraftState> }
  | { type: "files"; files: File[] }
  | { type: "remove"; key: string }
  | { type: "reset" }
  | { type: "hydrate"; state: DraftState }
  | { type: "load"; paste: PasteDetail };

let seq = 0;

function reducer(state: DraftState, action: Action): DraftState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.patch };
    case "files": {
      const added = action.files.map<DraftFile>((file) => ({
        key: `new-${++seq}`,
        name: file.name || "pasted-file",
        mime: file.type || "application/octet-stream",
        size: file.size,
        file,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      }));
      return { ...state, files: [...state.files, ...added] };
    }
    case "remove": {
      const target = state.files.find((file) => file.key === action.key);
      if (target?.url) URL.revokeObjectURL(target.url);
      return { ...state, files: state.files.filter((file) => file.key !== action.key) };
    }
    case "reset": {
      for (const file of state.files) if (file.url) URL.revokeObjectURL(file.url);
      return { ...EMPTY };
    }
    // A restored draft replaces the state wholesale; the previews it brings are its own.
    case "hydrate": {
      for (const file of state.files) if (file.url) URL.revokeObjectURL(file.url);
      return action.state;
    }
    case "load":
      return {
        title: action.paste.title,
        text: action.paste.text ?? "",
        language: action.paste.language as LanguageId,
        expiresIn: action.paste.expiresAt
          ? Math.max(0, action.paste.expiresAt - Math.round(Date.now() / 1000))
          : 0,
        burn: action.paste.burn,
        visibility: action.paste.visibility ?? "private",
        password: "",
        clearPassword: false,
        maxViews: action.paste.maxViews ?? 0,
        files: (action.paste.files ?? []).map((file) => ({
          key: `srv-${file.id}`,
          id: file.id,
          name: file.name,
          mime: file.mime,
          size: file.size,
        })),
      };
    default:
      return state;
  }
}

export function useDraft() {
  const [draft, dispatch] = useReducer(reducer, EMPTY);

  const set = useCallback((patch: Partial<DraftState>) => dispatch({ type: "patch", patch }), []);
  const addFiles = useCallback((files: File[]) => dispatch({ type: "files", files }), []);
  const removeFile = useCallback((key: string) => dispatch({ type: "remove", key }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);
  const load = useCallback((paste: PasteDetail) => dispatch({ type: "load", paste }), []);
  const hydrate = useCallback((state: DraftState) => dispatch({ type: "hydrate", state }), []);

  const counts = useMemo(() => {
    const lines = draft.text === "" ? 0 : draft.text.split("\n").length;
    const textBytes = new TextEncoder().encode(draft.text).length;
    const fileBytes = draft.files.reduce((total, file) => total + file.size, 0);
    return { lines, textBytes, fileBytes };
  }, [draft.text, draft.files]);

  return { draft, set, addFiles, removeFile, reset, load, hydrate, counts };
}
