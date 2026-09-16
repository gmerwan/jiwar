export interface AppConfig {
  port: number;
  webOrigin: string;
  databaseUrl: string;
  cookieSecret: string;
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
    maxRadiusKm: Number(process.env.MAX_RADIUS_KM ?? 100),
    defaultRadiusKm: Number(process.env.DEFAULT_RADIUS_KM ?? 20),
    pastGraceHours: Number(process.env.PAST_GRACE_HOURS ?? 24),
    nominatimBaseUrl: process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org",
    nominatimUserAgent: process.env.NOMINATIM_USER_AGENT ?? "jiwar-dev/0.1",
  };
}

export const APP_CONFIG = "APP_CONFIG";
