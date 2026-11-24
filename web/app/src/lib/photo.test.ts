import { describe, expect, it } from "vitest";

import { boxRatio, isPhoto, pixelLabel, positionLabel, srcSetFor, PHOTO_FALLBACK_RATIO } from "./photo";

describe("boxRatio", () => {
  it("reserves the measured shape", () => {
    expect(boxRatio({ width: 4284, height: 5712 })).toBe("4284 / 5712");
    expect(boxRatio({ width: 1920, height: 1080 })).toBe("1920 / 1080");
  });

  it("falls back rather than collapsing when nothing was measured", () => {
    expect(boxRatio({})).toBe(PHOTO_FALLBACK_RATIO);
    expect(boxRatio({ width: 0, height: 1200 })).toBe(PHOTO_FALLBACK_RATIO);
    expect(boxRatio({ width: 1200 })).toBe(PHOTO_FALLBACK_RATIO);
  });
});

describe("srcSetFor", () => {
  const urlFor = (width: number) => `/files/AB?w=${width}`;

  it("offers only the widths that exist", () => {
    expect(srcSetFor([1024, 2048], urlFor)).toBe("/files/AB?w=1024 1024w, /files/AB?w=2048 2048w");
    expect(srcSetFor([1024], urlFor)).toBe("/files/AB?w=1024 1024w");
  });

  it("says nothing when there is nothing to choose from", () => {
    expect(srcSetFor(undefined, urlFor)).toBeUndefined();
    expect(srcSetFor([], urlFor)).toBeUndefined();
  });
});

describe("labels", () => {
  it("prints the real pixel size, or nothing at all", () => {
    expect(pixelLabel({ width: 4284, height: 5712 })).toBe("4284 × 5712");
    expect(pixelLabel({})).toBeUndefined();
  });

  it("counts from one", () => {
    expect(positionLabel(0, 3)).toBe("1 / 3");
    expect(positionLabel(2, 3)).toBe("3 / 3");
  });
});

describe("isPhoto", () => {
  it("is about the mime, not the extension", () => {
    expect(isPhoto({ mime: "image/jpeg" })).toBe(true);
    expect(isPhoto({ mime: "application/pdf" })).toBe(false);
  });
});
