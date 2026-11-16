import { describe, expect, it } from "vitest";

import { deriveTitle } from "./title";

describe("deriveTitle", () => {
  it("takes the first line and strips markdown", () => {
    expect(deriveTitle("## deploy log\nmore", [])).toBe("deploy log");
    expect(deriveTitle("\n\n> quoted", [])).toBe("quoted");
  });
  it("clips long lines on a word boundary", () => {
    const long = "word ".repeat(30);
    const out = deriveTitle(long, []);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(65);
  });
  it("names files", () => {
    expect(deriveTitle("", [{ name: "report.pdf", mime: "application/pdf" }])).toBe("report.pdf");
    expect(
      deriveTitle("", [
        { name: "a.png", mime: "image/png" },
        { name: "b.png", mime: "image/png" },
      ]),
    ).toBe("2 images");
    expect(
      deriveTitle("", [
        { name: "a.png", mime: "image/png" },
        { name: "b.pdf", mime: "application/pdf" },
      ]),
    ).toBe("1 image, 1 file");
  });
  it("combines text and files", () => {
    expect(deriveTitle("crash loop", [{ name: "a.png", mime: "image/png" }])).toBe(
      "crash loop + 1 image",
    );
  });
});
