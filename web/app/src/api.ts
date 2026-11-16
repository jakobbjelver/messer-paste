export type PasteKind = "text" | "images" | "files" | "mixed";

export type PasteFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
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
  files: Array<{ name: string; mime: string; data: string }>;
};

type WireFile = { id: string; name: string; mime: string; size: number };
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
        error?: { code?: string; message?: string; field?: string };
      };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
      if (body?.error?.field) field = body.error.field;
    } catch {
      /* not JSON */
    }
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
  config: () => request<{ public_host: string }>("/api/v1/config"),
  unlock: (slug: string, password: string) =>
    request<void>(`/api/v1/pastes/${slug}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  rawUrl: (slug: string) => `/api/v1/pastes/${slug}/raw`,
  fileUrl: (slug: string, id: string, download = false) =>
    `/api/v1/pastes/${slug}/files/${id}${download ? "?download=1" : ""}`,
};
