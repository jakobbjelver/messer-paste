/**
 * Drafts survive the tab. A paste is often written on a phone, in a browser that is about to be
 * discarded; React state dies with it, so the draft is mirrored into IndexedDB — text always, the
 * attached bytes up to a cap. The server stays the only truth: this is a convenience copy, cleared
 * the moment the paste is saved.
 */
export type StoredFile = {
  name: string;
  mime: string;
  size: number;
  /** An attachment that has to be re-sent on save. Absent when the file already exists on the server. */
  blob?: Blob;
  /** The public id of a file that is already saved; such a file is kept, not re-uploaded. */
  id?: string;
};

export type StoredDraft = {
  key: string;
  savedAt: number;
  title: string;
  text: string;
  language: string;
  expiresIn: number;
  burn: boolean;
  visibility: "private" | "public";
  maxViews: number;
  files: StoredFile[];
};

/** A phone camera roll can outrun every quota there is; past this the words still get saved. */
export const MAX_BLOBS = 24 * 1024 * 1024;

/** A week-old draft is not a draft any more, it is a surprise. */
export const DRAFT_TTL = 7 * 86_400_000;

/**
 * A local draft that is older than the row it edits is stale: hydrating it would silently undo a
 * save made on another device. For a draft that is not editing anything, age is the only test.
 */
export function shouldHydrate(
  stored: StoredDraft | null,
  now: number,
  serverUpdatedAt?: number,
): boolean {
  if (!stored) return false;
  if (serverUpdatedAt !== undefined) return stored.savedAt > serverUpdatedAt * 1000;
  return now - stored.savedAt < DRAFT_TTL;
}

/** Over the cap the bytes go and the words stay: half a draft beats none. */
export function trimBlobs(files: StoredFile[], max = MAX_BLOBS): StoredFile[] {
  let total = 0;
  return files.filter((file) => {
    if (!file.blob) return true;
    total += file.size;
    return total <= max;
  });
}

/** Nothing worth restoring: the record is deleted instead of written. */
export function isBlank(record: Pick<StoredDraft, "title" | "text" | "files">): boolean {
  return record.title === "" && record.text === "" && record.files.length === 0;
}

const DB = "mpaste";
const STORE = "drafts";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = action(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

/** Private mode has no IndexedDB; every one of these answers "nothing stored" instead of throwing. */
export async function readDraft(key: string): Promise<StoredDraft | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const found = await run<StoredDraft | undefined>("readonly", (store) => store.get(key));
    return found ?? null;
  } catch {
    return null;
  }
}

export async function writeDraft(record: StoredDraft): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await run("readwrite", (store) => store.put(record));
  } catch {
    /* quota or private mode: the draft lives as long as the tab, as it did before */
  }
}

export async function clearDraft(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await run("readwrite", (store) => store.delete(key));
  } catch {
    /* nothing to clear */
  }
}
