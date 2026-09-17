export interface AppConfig {
  port: number;
  webOrigin: string;
  databaseUrl: string;
  cookieSecret: string;
  cookieSecure: boolean;
  maxRadiusKm: number;
  defaultRadiusKm: number;
  pastGraceHours: number;
  nominatimBaseUrl: string;
  nominatimUserAgent: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfig(): AppConfig {
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  // Defaults to false so local dev over plain HTTP keeps working. This must be
  // set to "true" in any deployment served over HTTPS — see .env.example. It
  // was previously read from NODE_ENV, which nothing in this repo (no
  // Dockerfile, no CI, no start script) ever sets, so the cookie would have
  // shipped without Secure in every real deployment silently.
  const cookieSecure = process.env.COOKIE_SECURE === "true";

  // A production-shaped WEB_ORIGIN with COOKIE_SECURE left at its insecure
  // default is exactly the misconfiguration Fix 2 exists to catch: an operator
  // who copies COOKIE_SECRET and DATABASE_URL into a production env and misses
  // this newer variable would otherwise ship the participant cookie without
  // Secure, with no warning. Only https:// origins are checked, so the fast
  // local dev loop (http://localhost:...) is unaffected.
  if (webOrigin.startsWith("https://") && !cookieSecure) {
    throw new Error(
      `WEB_ORIGIN is set to an https:// origin (${webOrigin}) but COOKIE_SECURE is not "true". ` +
        'Set COOKIE_SECURE=true so the participant cookie is sent with Secure, or point WEB_ORIGIN at an http:// origin for local development.',
    );
  }

  return {
    port: Number(process.env.PORT ?? 3000),
    webOrigin,
    databaseUrl: required("DATABASE_URL"),
    cookieSecret: required("COOKIE_SECRET"),
    cookieSecure,
    maxRadiusKm: Number(process.env.MAX_RADIUS_KM ?? 100),
    defaultRadiusKm: Number(process.env.DEFAULT_RADIUS_KM ?? 20),
    pastGraceHours: Number(process.env.PAST_GRACE_HOURS ?? 24),
    nominatimBaseUrl: process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org",
    nominatimUserAgent: process.env.NOMINATIM_USER_AGENT ?? "jiwar-dev/0.1",
  };
}

export const APP_CONFIG = "APP_CONFIG";
