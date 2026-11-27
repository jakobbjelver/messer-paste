import { markSessionExpired } from "@/lib/session";

export type PasteKind = "text" | "images" | "files" | "mixed";

export type PasteFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** The photo's size in display orientation; absent for anything unmeasurable. */
  width?: number;
  height?: number;
  /** Derivative widths the server actually holds, ascending. */
  thumbs?: number[];
};

export type Match = { field: "title" | "files" | "text"; snippet: string };

export type Visibility = "private" | "public";

export type PasteRow = {
  slug: string;
  title: string;
  language: string;
  kind: PasteKind;
  textBytes: number;
  fileBytes: number;
  fileCount: number;
  views: number;
  burn: boolean;
  visibility: Visibility;
  maxViews: number | null;
  locked: boolean;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  match?: Match;
};

export type PasteDetail = PasteRow & { text: string; files: PasteFile[] };

export type PastePage = {
  items: PasteRow[];
  nextCursor: string;
  hasMore: boolean;
  total: number;
  tookMs: number;
};

export type RevealPayload = {
  title: string;
  text: string;
  language: string;
  files: Array<{ name: string; mime: string; data: string; width?: number; height?: number }>;
};

type WireFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  thumbs?: number[];
};
type WireMatch = { field: Match["field"]; snippet: string };
type WirePaste = {
  slug: string;
  title: string;
  language: string;
  kind: PasteKind;
  text_bytes: number;
  file_bytes: number;
  file_count: number;
  views: number;
  burn: boolean;
  visibility: "private" | "public";
  max_views: number | null;
  locked: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  text?: string;
  files?: WireFile[];
  match?: WireMatch | null;
};

export class ApiError extends Error {
  status: number;
  code: string;
  /** The form field the server blamed, when it can name one. */
  field?: string;
  constructor(status: number, code: string, message?: string, field?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/**
 * Access refuses a call before the app ever sees it, and it is the only 401 that is not the app's:
 * a locked paste answers `E_LOCKED`, and its own 401s carry a code. `invalid_token` is Cloudflare's
 * word for "this browser holds no session for this host" — see `lib/session.ts`.
 */
export const isSessionExpiredError = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401 && error.code === "invalid_token";

const unix = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
};

function toPaste(wire: WirePaste): PasteRow {
  return {
    slug: wire.slug,
    title: wire.title,
    language: wire.language,
    kind: wire.kind,
    textBytes: wire.text_bytes,
    fileBytes: wire.file_bytes,
    fileCount: wire.file_count,
    views: wire.views,
    burn: wire.burn,
    visibility: wire.visibility ?? "private",
    maxViews: wire.max_views ?? null,
    locked: wire.locked ?? false,
    expiresAt: unix(wire.expires_at),
    createdAt: unix(wire.created_at) ?? 0,
    updatedAt: unix(wire.updated_at) ?? 0,
    ...(wire.match ? { match: { field: wire.match.field, snippet: wire.match.snippet } } : {}),
  };
}

function toDetail(wire: WirePaste): PasteDetail {
  return {
    ...toPaste(wire),
    text: wire.text ?? "",
    files: wire.files ?? [],
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let code = "E_INTERNAL";
    let message = res.statusText;
    let field: string | undefined;
    try {
      const body = (await res.json()) as {
        // The app's own shape is `{"error":{"code":…}}`; Cloudflare Access answers a refused call
        // with `{"error":"invalid_token","error_description":…}` — a string, not an object.
        error?: { code?: string; message?: string; field?: string } | string;
        error_description?: string;
      };
      const flat = typeof body?.error === "string" ? body.error : undefined;
      if (flat) {
        code = flat;
        message = body.error_description || flat;
      } else if (body?.error && typeof body.error === "object") {
        if (body.error.code) code = body.error.code;
        if (body.error.message) message = body.error.message;
        if (body.error.field) field = body.error.field;
      }
    } catch {
      /* not JSON */
    }
    if (res.status === 401 && code === "invalid_token") markSessionExpired();
    throw new ApiError(res.status, code, message, field);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type ListParams = { q?: string; limit?: number; cursor?: string };

export const api = {
  list: async (params: ListParams = {}): Promise<PastePage> => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.limit) search.set("limit", String(params.limit));
    if (params.cursor) search.set("cursor", params.cursor);
    const query = search.toString();
    const wire = await request<{
      items: WirePaste[];
      next_cursor: string;
      has_more: boolean;
      total: number;
      took_ms: number;
    }>("/api/v1/pastes" + (query ? `?${query}` : ""));
    return {
      items: wire.items.map(toPaste),
      nextCursor: wire.next_cursor,
      hasMore: wire.has_more,
      total: wire.total,
      tookMs: wire.took_ms,
    };
  },
  get: async (slug: string) => toDetail(await request<WirePaste>(`/api/v1/pastes/${slug}`)),
  create: async (form: FormData) =>
    toDetail(await request<WirePaste>("/api/v1/pastes", { method: "POST", body: form })),
  update: async (slug: string, form: FormData) =>
    toDetail(await request<WirePaste>(`/api/v1/pastes/${slug}`, { method: "PUT", body: form })),
  remove: (slug: string) => request<void>(`/api/v1/pastes/${slug}`, { method: "DELETE" }),
  purge: () => request<{ deleted: number }>("/api/v1/pastes", { method: "DELETE" }),
  reveal: (slug: string) =>
    request<RevealPayload>(`/api/v1/pastes/${slug}/reveal`, { method: "POST" }),
  config: () => request<AppConfig>("/api/v1/config"),
  settings: () => request<SettingsBody>("/api/v1/settings"),
  saveSettings: (patch: Record<string, unknown>) =>
    request<SettingsBody>("/api/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  unlock: (slug: string, password: string) =>
    request<void>(`/api/v1/pastes/${slug}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  rawUrl: (slug: string) => `/api/v1/pastes/${slug}/raw`,
  fileUrl: (slug: string, id: string, download = false) =>
    `/api/v1/pastes/${slug}/files/${id}${download ? "?download=1" : ""}`,
  /** A derivative the server said it wrote. Never a width the file does not carry. */
  thumbUrl: (slug: string, id: string, width: number) =>
    `/api/v1/pastes/${slug}/files/${id}?w=${width}`,
};

export type ExpiryChoice = { seconds: number; label: string };

export type AppConfig = {
  public_links: boolean;
  public_host: string;
  share_base: string;
  read_only: boolean;
  burn_enabled: boolean;
  copy_on_create: boolean;
  password_required: boolean;
  default_expiry: number;
  default_visibility: "private" | "public";
  expiry_choices: ExpiryChoice[];
  recent_page_size: number;
  search_min_chars: number;
  limits: { text: number; file: number; paste: number; burn: number; files: number };
};

export type SettingKind = "int" | "bool" | "enum" | "duration" | "text" | "list";
export type SettingSource = "default" | "env" | "custom";

export type Setting = {
  key: string;
  env: string;
  group: string;
  label: string;
  description: string;
  kind: SettingKind;
  unit?: string;
  default: unknown;
  min?: number;
  max?: number;
  choices?: string[];
  boot: boolean;
  advanced?: boolean;
  value: unknown;
  source: SettingSource;
  editable: boolean;
};

export type SettingsBody = { items: Setting[]; groups: string[]; custom: number };
