import { describe, expect, it } from "vitest";

import { advance, backTarget, EMPTY_TRAIL, parseTrail, type Trail } from "./trail";

function walk(paths: string[], replaceIndex: number[] = []): Trail {
  return paths.reduce<Trail>(
    (trail, path, index) => advance(trail, path, replaceIndex.includes(index)),
    EMPTY_TRAIL,
  );
}

describe("trail", () => {
  it("walks one step back, never to the page it came from", () => {
    // recent → paste → edit → save. The save replaces the editor entry, so Back is Recent.
    const trail = walk(["/recent", "/ABC", "/ABC/edit", "/ABC"], [3]);
    expect(trail.list).toEqual(["/recent", "/ABC"]);
    expect(backTarget(trail)).toBe("/recent");

    // Without the replace marker the same walk still cannot target the page it is on: arriving at a
    // URL that is exactly one step behind reads as history moving back.
    const plain = walk(["/recent", "/ABC", "/ABC/edit", "/ABC"]);
    expect(backTarget(plain)).not.toBe("/ABC");
    expect(backTarget(plain)).toBe("/recent");
  });

  it("steps the cursor instead of pushing when history moves", () => {
    const trail = walk(["/recent", "/ABC"]);
    const back = advance(trail, "/recent");
    expect(back.at).toBe(0);
    expect(backTarget(back)).toBeNull();

    const forward = advance(back, "/ABC");
    expect(forward.at).toBe(1);
    expect(forward.list).toEqual(["/recent", "/ABC"]);
  });

  it("drops the forward branch when a new destination arrives", () => {
    const trail = advance(advance(walk(["/recent", "/ABC", "/settings"]), "/ABC"), "/newpage");
    expect(trail.list).toEqual(["/recent", "/ABC", "/newpage"]);
    expect(trail.at).toBe(2);
  });

  it("ignores a repeated navigation to the page it is on", () => {
    const trail = walk(["/recent", "/ABC"]);
    expect(advance(trail, "/ABC")).toBe(trail);
  });

  it("keeps the list bounded", () => {
    const paths = Array.from({ length: 40 }, (_, index) => `/p${index}`);
    const trail = walk(paths);
    expect(trail.list.length).toBe(24);
    expect(trail.list[trail.list.length - 1]).toBe("/p39");
    expect(backTarget(trail)).toBe("/p38");
  });
});

describe("parseTrail", () => {
  it("ignores the pre-cursor array and junk", () => {
    expect(parseTrail(null)).toEqual(EMPTY_TRAIL);
    expect(parseTrail("[\"/recent\",\"/ABC\"]")).toEqual(EMPTY_TRAIL);
    expect(parseTrail("not json")).toEqual(EMPTY_TRAIL);
  });

  it("clamps a cursor that no longer fits", () => {
    expect(parseTrail(JSON.stringify({ list: ["/a"], at: 9 }))).toEqual({ list: ["/a"], at: 0 });
    expect(parseTrail(JSON.stringify({ list: [], at: 3 })).at).toBe(-1);
  });
});
