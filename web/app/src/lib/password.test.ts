import { describe, expect, it } from "vitest";

import { generatePassword } from "@/lib/password";

describe("generatePassword", () => {
  it("returns the requested length", () => {
    expect(generatePassword()).toHaveLength(16);
    expect(generatePassword(24)).toHaveLength(24);
  });

  it("uses only the unambiguous alphabet", () => {
    const password = generatePassword(64);
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
  });

  it("does not repeat itself", () => {
    const draws = new Set(Array.from({ length: 200 }, () => generatePassword()));
    expect(draws.size).toBe(200);
  });
});
