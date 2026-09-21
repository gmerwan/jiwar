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

/**
 * The `COOKIE_SECRET` strength floor.
 *
 * `required()` rejects only an *empty* value, so before these tests `loadConfig()`
 * accepted a one-character secret and the published `.env.example` placeholder
 * alike. Both were measured booting cleanly. That is not a hardening nicety: the
 * signed cookie is the entirety of authorship here — no accounts, no sessions —
 * so recovering the secret from one observed cookie (trivial for one character
 * against HMAC-SHA1, and free for a value committed to this repo) lets anyone mint
 * `jiwar_pid=<victim id>.<mac>` and cancel a stranger's notice.
 */
describe("loadConfig COOKIE_SECRET strength", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    // Only DATABASE_URL, so each case below owns COOKIE_SECRET outright. WEB_ORIGIN
    // is left unset, which defaults to http://localhost:5173 and keeps the
    // cookieSecure cross-check above out of the way.
    process.env.DATABASE_URL = BASE_ENV.DATABASE_URL;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  it.each([
    ["a single character", "x"],
    ["31 characters — one short of the floor", "a".repeat(31)],
    ["a short but random-looking value", "s3cr3t"],
  ])("throws for a secret that is too short (%s)", (_label, secret) => {
    process.env.COOKIE_SECRET = secret;
    // The message must name the variable and say what is wrong with it, because
    // the operator reading it is looking at a process that refused to start.
    expect(() => loadConfig()).toThrow(/COOKIE_SECRET is too short/);
    expect(() => loadConfig()).toThrow(/at least 32/);
  });

  it("throws for the exact placeholder that .env.example used to ship", () => {
    // Verbatim, not a substring: this is the value a copied .env.example leaves
    // behind, it is 41 characters long so the length floor alone waves it through,
    // and it is in this repository's git history — a published secret.
    process.env.COOKIE_SECRET = "change-me-in-production-min-32-chars-long";
    expect(() => loadConfig()).toThrow(/COOKIE_SECRET is still the placeholder/);
  });

  it("throws for the placeholder .env.example ships now", () => {
    process.env.COOKIE_SECRET = "CHANGE_ME";
    expect(() => loadConfig()).toThrow(/COOKIE_SECRET/);
  });

  it.each([
    ["exactly 32 characters", "a".repeat(32)],
    ["a 48-byte base64 secret", "9uPq2oXk7ZbW1sT4vN6mLd8eR0yGhJc5AaBbCcDdEeFfGgHh"],
  ])("accepts a secret at or above the floor (%s)", (_label, secret) => {
    process.env.COOKIE_SECRET = secret;
    expect(loadConfig().cookieSecret).toBe(secret);
  });

  it("still throws when COOKIE_SECRET is absent entirely", () => {
    // The pre-existing required() behaviour, pinned so the new check cannot
    // accidentally replace it with something that treats undefined as "fine".
    delete process.env.COOKIE_SECRET;
    expect(() => loadConfig()).toThrow(/Missing required environment variable: COOKIE_SECRET/);
  });

  it("still throws when COOKIE_SECRET is set but empty", () => {
    process.env.COOKIE_SECRET = "";
    expect(() => loadConfig()).toThrow(/Missing required environment variable: COOKIE_SECRET/);
  });
});
