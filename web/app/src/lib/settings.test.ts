import { describe, expect, it } from "vitest";

import { byteUnit, byteValue, defaultLabel, durationLabel, isDefault, LOCK_CLOSER, lockReason, rowUnit } from "./settings";

describe("byteUnit", () => {
  it("reads a byte count in the unit that fits it", () => {
    expect(byteUnit(0)).toBe("B");
    expect(byteUnit(512)).toBe("B");
    expect(byteUnit(1024)).toBe("KB");
    expect(byteUnit(4096)).toBe("KB");
    expect(byteUnit(2 * 1024 ** 2)).toBe("MB");
    expect(byteUnit(250 * 1024 ** 2)).toBe("MB");
    expect(byteUnit(2 * 1024 ** 3)).toBe("GB");
    expect(byteUnit("nonsense")).toBe("B");
  });
});

describe("byteValue", () => {
  it("prints the number a field in that unit holds", () => {
    expect(byteValue(2 * 1024 ** 2, "MB")).toBe("2");
    expect(byteValue(100 * 1024 ** 2, "MB")).toBe("100");
    expect(byteValue(1.5 * 1024 ** 2, "MB")).toBe("1.5");
    expect(byteValue(1024 * 1024 * 1.25, "MB")).toBe("1.25");
    expect(byteValue(4096, "KB")).toBe("4");
    expect(byteValue(3 * 1024 ** 3, "GB")).toBe("3");
    expect(byteValue("nonsense", "MB")).toBe("");
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
    expect(isDefault({ default: 2 * 1024 ** 2 }, 2 * 1024 ** 2)).toBe(true);
    expect(isDefault({ default: 2 * 1024 ** 2 }, 150 * 1024 ** 2)).toBe(false);
    expect(isDefault({ default: "" }, "")).toBe(true);
    expect(isDefault({ default: "" }, "https://example.com")).toBe(false);
    expect(isDefault({ default: true }, true)).toBe(true);
    expect(isDefault({ default: false }, true)).toBe(false);
    expect(isDefault({ default: "1h,24h,7d,0" }, "1h,24h,7d,0")).toBe(true);
  });
});

describe("defaultLabel", () => {
  it("prints the default the way the row reads", () => {
    expect(defaultLabel({ kind: "int", unit: "bytes", default: 2 * 1024 ** 2 })).toBe("2 MB");
    expect(defaultLabel({ kind: "int", unit: "bytes", default: 250 * 1024 ** 2 })).toBe("250 MB");
    expect(defaultLabel({ kind: "int", unit: "bytes", default: 4096 })).toBe("4 KB");
    expect(defaultLabel({ kind: "int", unit: "bytes", default: 0 })).toBe("0 B");
    expect(defaultLabel({ kind: "duration", default: "24h" })).toBe("24 hours");
    expect(defaultLabel({ kind: "duration", default: "0" })).toBe("never");
    expect(defaultLabel({ kind: "bool", default: true })).toBe("on");
    expect(defaultLabel({ kind: "bool", default: false })).toBe("off");
    expect(defaultLabel({ kind: "text", default: "" })).toBe("empty");
    expect(defaultLabel({ kind: "list", default: "1h,24h,7d,0" })).toBe("1h,24h,7d,0");
  });
});

describe("rowUnit", () => {
  const item = { unit: "bytes", default: 2 * 1024 ** 2 };

  it("follows the saved value, and the default when the row sits at it", () => {
    expect(rowUnit(item, 8 * 1024 ** 2, 8 * 1024 ** 2)).toBe("MB");
    expect(rowUnit(item, 2 * 1024 ** 3, 2 * 1024 ** 3)).toBe("GB");
    // Reset: the draft is the default, so the field speaks the default's unit even though the saved
    // value is a gigabyte away.
    expect(rowUnit(item, 2 * 1024 ** 2, 2 * 1024 ** 3)).toBe("MB");
  });

  it("does not relabel itself for a keystroke in flight", () => {
    // Clearing the field leaves 0 bytes in the draft; the unit must stay where the value was saved.
    expect(rowUnit(item, 0, 8 * 1024 ** 2)).toBe("MB");
    expect(rowUnit(item, 512, 8 * 1024 ** 2)).toBe("MB");
  });

  it("is undefined for a row without bytes", () => {
    expect(rowUnit({ unit: undefined, default: 20 }, 21, 20)).toBeUndefined();
  });
});

describe("lockReason", () => {
  const text = (parts: { text: string }[]) => parts.map((part) => part.text).join("");
  const mono = (parts: { mono?: boolean; text: string }[]) =>
    parts.filter((part) => part.mono).map((part) => part.text);

  it("names the variable in mono inside the sentence", () => {
    expect(mono(lockReason({ boot: false, env: "PUBLIC_HOST" }))).toEqual(["PUBLIC_HOST"]);
    expect(text(lockReason({ boot: false, env: "PUBLIC_HOST" }))).toContain(
      "Set by PUBLIC_HOST in the environment, so it cannot be changed here.",
    );
    expect(mono(lockReason({ boot: true, env: "PORT" }))).toEqual(["PORT"]);
    expect(text(lockReason({ boot: true, env: "PORT" }))).toBe("PORT is read when the process starts.");
  });

  it("shares one closing line, said once", () => {
    expect(LOCK_CLOSER).toBe("Restart the container to change it.");
    for (const parts of [lockReason({ boot: true, env: "PORT" }), lockReason({ boot: false, env: "PUBLIC_HOST" })]) {
      expect(text(parts)).not.toContain("Restart");
    }
  });
});
