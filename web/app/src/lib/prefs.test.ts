import { describe, expect, it } from "vitest";

import { parseWrap } from "./prefs";

describe("parseWrap", () => {
  it("prefers what was stored", () => {
    expect(parseWrap("1", false)).toBe(true);
    expect(parseWrap("0", true)).toBe(false);
  });

  it("falls back to the viewport on a first visit", () => {
    expect(parseWrap(null, true)).toBe(true);
    expect(parseWrap(null, false)).toBe(false);
    expect(parseWrap("junk", false)).toBe(false);
  });
});
