import { describe, expect, it } from "vitest";

import { ago, bytes, expiringSoon, kindLabel, remaining } from "./format";

describe("bytes", () => {
  it("keeps bytes exact and scales the rest", () => {
    expect(bytes(0)).toBe("0 B");
    expect(bytes(999)).toBe("999 B");
    expect(bytes(1024)).toBe("1 KB");
    expect(bytes(1150)).toBe("1.1 KB");
    expect(bytes(1024 * 1024 * 1.4)).toBe("1.4 MB");
  });
});

describe("time", () => {
  const now = 1_700_000_000_000;
  it("prints compact ages", () => {
    expect(ago(now / 1000 - 10, now)).toBe("now");
    expect(ago(now / 1000 - 120, now)).toBe("2m");
    expect(ago(now / 1000 - 7200, now)).toBe("2h");
  });
  it("prints remaining time from unix seconds", () => {
    expect(remaining(null)).toBe("never");
    expect(remaining(Math.round(now / 1000) + 47 * 60, now)).toBe("47m");
    expect(remaining(Math.round(now / 1000) - 1, now)).toBe("expired");
  });
  it("flags the last two hours", () => {
    expect(expiringSoon(Math.round(now / 1000) + 3600, now)).toBe(true);
    expect(expiringSoon(Math.round(now / 1000) + 3 * 3600, now)).toBe(false);
    expect(expiringSoon(null, now)).toBe(false);
  });
});

describe("kindLabel", () => {
  it("names every kind", () => {
    expect(kindLabel("text")).toBe("Text");
    expect(kindLabel("images")).toBe("Images");
    expect(kindLabel("files")).toBe("Files");
    expect(kindLabel("mixed")).toBe("Mixed");
  });
});
