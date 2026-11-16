export type PasteKind = "text" | "images" | "files" | "mixed";

export type PasteFile = {
  id: number;
  name: string;
  mime: string;
  size: number;
};

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
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type PasteDetail = PasteRow & { text: string; files: PasteFile[] };

export type RevealPayload = {
  title: string;
  text: string;
  language: string;
  files: Array<{ name: string; mime: string; data: string }>;
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let code = res.statusText || "request_failed";
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) code = body.error;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  list: () => request<PasteRow[]>("/api/pastes"),
  get: (slug: string) => request<PasteDetail>(`/api/pastes/${slug}`),
  create: (form: FormData) => request<PasteDetail>("/api/pastes", { method: "POST", body: form }),
  update: (slug: string, form: FormData) =>
    request<PasteDetail>(`/api/pastes/${slug}`, { method: "PUT", body: form }),
  remove: (slug: string) => request<void>(`/api/pastes/${slug}`, { method: "DELETE" }),
  purge: () => request<{ deleted: number }>("/api/pastes", { method: "DELETE" }),
  reveal: (slug: string) => request<RevealPayload>(`/api/pastes/${slug}/reveal`, { method: "POST" }),
  rawUrl: (slug: string) => `/api/pastes/${slug}/raw`,
  fileUrl: (slug: string, id: number, download = false) =>
    `/api/pastes/${slug}/files/${id}${download ? "?download=1" : ""}`,
};
