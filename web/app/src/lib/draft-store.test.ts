import { describe, expect, it } from "vitest";

import { DRAFT_TTL, isBlank, shouldHydrate, trimBlobs, type StoredDraft } from "./draft-store";

function record(patch: Partial<StoredDraft> = {}): StoredDraft {
  return {
    key: "new",
    savedAt: 1_000_000,
    title: "",
    text: "hello",
    language: "text",
    expiresIn: 86_400,
    burn: false,
    visibility: "private",
    maxViews: 0,
    files: [],
    ...patch,
  };
}

describe("shouldHydrate", () => {
  const now = 1_000_000 + 1000;

  it("needs a record", () => {
    expect(shouldHydrate(null, now)).toBe(false);
  });

  it("restores a fresh composer draft and drops a stale one", () => {
    expect(shouldHydrate(record({ savedAt: now - 1000 }), now)).toBe(true);
    expect(shouldHydrate(record({ savedAt: now - DRAFT_TTL - 1 }), now)).toBe(false);
  });

  it("never overwrites a save that is newer than the draft", () => {
    // server updated_at is unix seconds; the draft is milliseconds
    expect(shouldHydrate(record({ savedAt: 1_000_000 }), now, 900)).toBe(true);
    expect(shouldHydrate(record({ savedAt: 1_000_000 }), now, 1200)).toBe(false);
  });
});

describe("trimBlobs", () => {
  const blob = (size: number) => ({ name: "a", mime: "image/png", size, blob: new Blob(["x"]) });

  it("keeps files that are already on the server for free", () => {
    const kept = { name: "b", mime: "text/plain", size: 10_000_000, id: "ABCD2345" };
    expect(trimBlobs([kept], 10)).toEqual([kept]);
  });

  it("stops at the cap and drops the rest", () => {
    const files = [blob(6), blob(6), blob(1)];
    expect(trimBlobs(files, 10).length).toBe(1);
    expect(trimBlobs(files, 100).length).toBe(3);
  });
});

describe("isBlank", () => {
  it("treats a title-only draft as worth keeping", () => {
    expect(isBlank({ title: "a title", text: "", files: [] })).toBe(false);
    expect(isBlank({ title: "", text: "", files: [] })).toBe(true);
  });
});
