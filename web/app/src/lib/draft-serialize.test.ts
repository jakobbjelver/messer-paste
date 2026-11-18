import { describe, expect, it } from "vitest";

import type { DraftState } from "@/hooks/use-draft";

import { draftFromStored, storedFromDraft } from "./draft-serialize";
import { EMPTY } from "@/hooks/use-draft";

const draft: DraftState = {
  ...EMPTY,
  title: "a title",
  text: "the body",
  files: [
    { key: "new-1", name: "shot.png", mime: "image/png", size: 3, file: new File(["abc"], "shot.png", { type: "image/png" }) },
    { key: "srv-ABCD2345", id: "ABCD2345", name: "kept.scad", mime: "text/plain", size: 9 },
  ],
};

describe("draft serialization", () => {
  it("round-trips the words, the new bytes and the kept ids", () => {
    const stored = storedFromDraft("ABC", draft, 5000);
    expect(stored.key).toBe("ABC");
    expect(stored.savedAt).toBe(5000);
    expect(stored.files.map((file) => [file.name, Boolean(file.blob), file.id])).toEqual([
      ["shot.png", true, undefined],
      ["kept.scad", false, "ABCD2345"],
    ]);

    const back = draftFromStored(stored, () => "blob:url");
    expect(back.title).toBe("a title");
    expect(back.text).toBe("the body");
    expect(back.files[0].file?.size).toBe(3);
    expect(back.files[0].url).toBe("blob:url");
    expect(back.files[1].id).toBe("ABCD2345");
    expect(back.files[1].file).toBeUndefined();
  });

  it("does not mint an object URL for a file the browser cannot preview", () => {
    const stored = storedFromDraft("ABC", { ...EMPTY, text: "x", files: [draft.files[1]] });
    expect(draftFromStored(stored, () => "blob:url").files[0].url).toBeUndefined();
  });
});
