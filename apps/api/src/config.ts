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
  return {
    port: Number(process.env.PORT ?? 3000),
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    databaseUrl: required("DATABASE_URL"),
    cookieSecret: required("COOKIE_SECRET"),
    // Defaults to false so local dev over plain HTTP keeps working. This must be
    // set to "true" in any deployment served over HTTPS — see .env.example. It
    // was previously read from NODE_ENV, which nothing in this repo (no
    // Dockerfile, no CI, no start script) ever sets, so the cookie would have
    // shipped without Secure in every real deployment silently.
    cookieSecure: process.env.COOKIE_SECURE === "true",
    maxRadiusKm: Number(process.env.MAX_RADIUS_KM ?? 100),
    defaultRadiusKm: Number(process.env.DEFAULT_RADIUS_KM ?? 20),
    pastGraceHours: Number(process.env.PAST_GRACE_HOURS ?? 24),
    nominatimBaseUrl: process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org",
    nominatimUserAgent: process.env.NOMINATIM_USER_AGENT ?? "jiwar-dev/0.1",
  };
}

export const APP_CONFIG = "APP_CONFIG";
