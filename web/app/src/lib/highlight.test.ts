import { describe, expect, it } from "vitest";

import { highlight } from "./highlight";

describe("highlight", () => {
  it("escapes markup instead of rendering it", () => {
    const out = highlight('<img src=x onerror="alert(1)">', "html");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("wraps keywords and strings", () => {
    const out = highlight('const x = "hello";', "typescript");
    expect(out).toContain('<span class="tk-k">const</span>');
    expect(out).toContain('<span class="tk-s">"hello"</span>');
  });

  it("treats # as a comment only where it is one", () => {
    expect(highlight("# note\nx = 1", "python")).toContain("tk-c");
    expect(highlight("#private x = 1", "typescript")).not.toContain("tk-c");
  });
});
