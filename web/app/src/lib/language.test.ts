import { describe, expect, it } from "vitest";

import { detectLanguage, languageLabel } from "./language";

describe("detectLanguage", () => {
  it("reads the extension first", () => {
    expect(detectLanguage("", "notes.md")).toBe("text");
    expect(detectLanguage("x", "a.py")).toBe("python");
    expect(detectLanguage("x", "a.tsx")).toBe("typescript");
  });
  it("falls back to the content", () => {
    expect(detectLanguage("#!/usr/bin/env bash\necho hi")).toBe("shell");
    expect(detectLanguage('{"a": 1}')).toBe("json");
    expect(detectLanguage("<!doctype html><html></html>")).toBe("html");
    expect(detectLanguage("package main\nfunc main() {}")).toBe("go");
    expect(detectLanguage("def main():\n  pass")).toBe("python");
    expect(detectLanguage("const x: string = 'a'")).toBe("typescript");
  });
  it("never guesses for prose", () => {
    expect(detectLanguage("just some words about a thing")).toBe("text");
  });
});

describe("languageLabel", () => {
  it("names known ids and falls back to plain text", () => {
    expect(languageLabel("auto")).toBe("Auto");
    expect(languageLabel("typescript")).toBe("TypeScript");
    expect(languageLabel("nope")).toBe("Plain text");
  });
});
