import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

// Required vars unrelated to this check, set so loadConfig() gets past
// required() and reaches the webOrigin/cookieSecure cross-check below.
const BASE_ENV = {
  DATABASE_URL: "postgresql://jiwar:jiwar@localhost:55432/jiwar_test",
  COOKIE_SECRET: "test-secret-at-least-32-characters-long",
};

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, BASE_ENV);
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  // The exact scenario Fix 2 exists to catch: an operator ships WEB_ORIGIN
  // pointed at a real HTTPS deployment but never sets COOKIE_SECURE, so the
  // cookie would go out without Secure with no warning at all.
  it("throws when WEB_ORIGIN is https:// and COOKIE_SECURE is left at its insecure default", () => {
    process.env.WEB_ORIGIN = "https://jiwar.dz";
    // COOKIE_SECURE intentionally left unset here.
    expect(() => loadConfig()).toThrow(/WEB_ORIGIN.*https:\/\/jiwar\.dz.*COOKIE_SECURE/s);
  });

  it("loads normally for local dev: http:// origin with cookieSecure false", () => {
    process.env.WEB_ORIGIN = "http://localhost:5173";
    // COOKIE_SECURE intentionally left unset (defaults to false).
    const config = loadConfig();
    expect(config.webOrigin).toBe("http://localhost:5173");
    expect(config.cookieSecure).toBe(false);
  });

  it("loads normally for a real deployment: https:// origin with cookieSecure true", () => {
    process.env.WEB_ORIGIN = "https://jiwar.dz";
    process.env.COOKIE_SECURE = "true";
    const config = loadConfig();
    expect(config.webOrigin).toBe("https://jiwar.dz");
    expect(config.cookieSecure).toBe(true);
  });
});
