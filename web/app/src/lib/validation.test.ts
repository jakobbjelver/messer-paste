import { describe, expect, it } from "vitest";

import { validateDraft } from "@/lib/validation";
import type { DraftState } from "@/hooks/use-draft";

const base: DraftState = {
  title: "",
  text: "hello",
  language: "auto",
  expiresIn: 86_400,
  burn: false,
  visibility: "private",
  password: "",
  clearPassword: false,
  maxViews: 0,
  files: [],
};

const draft = (patch: Partial<DraftState>): DraftState => ({ ...base, ...patch });

describe("validateDraft", () => {
  it("accepts a private paste with text", () => {
    expect(validateDraft(base)).toEqual([]);
  });

  it("refuses an empty draft", () => {
    expect(validateDraft(draft({ text: "" }))).toEqual([
      { field: "text", message: "There is nothing to save yet." },
    ]);
  });

  it("refuses a public paste without an expiry", () => {
    const errors = validateDraft(draft({ visibility: "public", expiresIn: 0 }));
    expect(errors.map((entry) => entry.field)).toContain("expiry");
  });

  it("refuses burn on a public paste", () => {
    const errors = validateDraft(draft({ visibility: "public", burn: true }));
    expect(errors.map((entry) => entry.field)).toContain("burn");
  });

  it("refuses a short password", () => {
    const errors = validateDraft(draft({ visibility: "public", password: "abc" }));
    expect(errors).toEqual([{ field: "password", message: "Use at least 8 characters." }]);
  });

  it("accepts a public paste with a password and a cap", () => {
    expect(
      validateDraft(draft({ visibility: "public", password: "correct horse", maxViews: 3 })),
    ).toEqual([]);
  });

  it("ignores password rules on a private paste", () => {
    expect(validateDraft(draft({ visibility: "private", password: "x" }))).toEqual([]);
  });
});
