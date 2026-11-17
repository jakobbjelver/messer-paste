import { describe, expect, it } from "vitest";

import { defaultLabel, durationLabel, inMiB, isDefault, lockReason } from "./settings";

describe("inMiB", () => {
  it("prints whole and fractional mebibytes", () => {
    expect(inMiB(2 * 1024 * 1024)).toBe("2");
    expect(inMiB(150 * 1024 * 1024)).toBe("150");
    expect(inMiB(1.5 * 1024 * 1024)).toBe("1.5");
    expect(inMiB(1024 * 1024 * 1.25)).toBe("1.25");
    expect(inMiB("nonsense")).toBe("");
  });
});

describe("durationLabel", () => {
  it("spells a duration as an option would", () => {
    expect(durationLabel("0")).toBe("never");
    expect(durationLabel("1h")).toBe("1 hour");
    expect(durationLabel("24h")).toBe("24 hours");
    expect(durationLabel("7d")).toBe("7 days");
    expect(durationLabel("4w")).toBe("4 weeks");
    expect(durationLabel("90m")).toBe("90m");
  });
});

describe("isDefault", () => {
  it("compares the draft against the catalog's own default", () => {
    expect(isDefault({ default: 2 * 1024 * 1024 }, 2 * 1024 * 1024)).toBe(true);
    expect(isDefault({ default: 2 * 1024 * 1024 }, 150 * 1024 * 1024)).toBe(false);
    expect(isDefault({ default: "" }, "")).toBe(true);
    expect(isDefault({ default: "" }, "https://example.com")).toBe(false);
    expect(isDefault({ default: true }, true)).toBe(true);
    expect(isDefault({ default: false }, true)).toBe(false);
    expect(isDefault({ default: "1h,24h,7d,0" }, "1h,24h,7d,0")).toBe(true);
  });
});

describe("defaultLabel", () => {
  it("prints the default the way the row reads", () => {
    expect(defaultLabel({ kind: "int", unit: "bytes", default: 2 * 1024 * 1024 })).toBe("2 MiB");
    expect(defaultLabel({ kind: "duration", default: "24h" })).toBe("24 hours");
    expect(defaultLabel({ kind: "duration", default: "0" })).toBe("never");
    expect(defaultLabel({ kind: "bool", default: true })).toBe("on");
    expect(defaultLabel({ kind: "bool", default: false })).toBe("off");
    expect(defaultLabel({ kind: "text", default: "" })).toBe("empty");
    expect(defaultLabel({ kind: "list", default: "1h,24h,7d,0" })).toBe("1h,24h,7d,0");
  });
});

describe("lockReason", () => {
  it("says which kind of lock it is", () => {
    expect(lockReason({ boot: false, env: "PUBLIC_HOST" })).toContain("Set by PUBLIC_HOST in the environment");
    expect(lockReason({ boot: true, env: "PORT" })).toContain("PORT is read when the process starts");
  });
});
