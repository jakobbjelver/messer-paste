import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, isSessionExpiredError } from "@/api";
import {
  REAUTH_PATH,
  isSessionExpired,
  markSessionExpired,
  resetSession,
  subscribeSession,
} from "@/lib/session";

afterEach(() => resetSession());

describe("session expiry", () => {
  it("flips once and notifies its listeners once", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);

    expect(isSessionExpired()).toBe(false);
    markSessionExpired();
    markSessionExpired();
    markSessionExpired();

    expect(isSessionExpired()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stops notifying a listener that left", () => {
    const listener = vi.fn();
    subscribeSession(listener)();
    markSessionExpired();
    expect(listener).not.toHaveBeenCalled();
  });

  it("is not confused with the app's own 401", () => {
    expect(isSessionExpiredError(new ApiError(401, "invalid_token"))).toBe(true);
    expect(isSessionExpiredError(new ApiError(401, "E_LOCKED"))).toBe(false);
    expect(isSessionExpiredError(new ApiError(500, "invalid_token"))).toBe(false);
    expect(isSessionExpiredError(new Error("Load failed"))).toBe(false);
  });

  it("reads Access's flat error body and marks the session", async () => {
    // Exactly what the edge answers a browser with no session: a 401 whose `error` is a string.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "invalid_token",
              error_description: "Missing or invalid access token",
            }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    let caught: unknown;
    try {
      await api.config();
    } catch (error) {
      caught = error;
    }

    expect(isSessionExpiredError(caught)).toBe(true);
    expect(isSessionExpired()).toBe(true);
    expect((caught as ApiError).message).toBe("Missing or invalid access token");
    vi.unstubAllGlobals();
  });

  it("leaves the app's own 401 alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "E_LOCKED", message: "Locked" } }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    let caught: unknown;
    try {
      await api.config();
    } catch (error) {
      caught = error;
    }

    expect((caught as ApiError).code).toBe("E_LOCKED");
    expect(isSessionExpiredError(caught)).toBe(false);
    expect(isSessionExpired()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("keeps the worker's hands off the reauth path", () => {
    // The recovery only works if the navigation reaches the edge instead of the precached shell.
    const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
    const denylist = /navigateFallbackDenylist:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? "";

    expect(REAUTH_PATH).toBe("/reauth");
    expect(denylist).toContain(REAUTH_PATH.slice(1));
  });
});
