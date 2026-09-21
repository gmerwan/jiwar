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

/**
 * The shortest `COOKIE_SECRET` this app will boot with.
 *
 * 32 characters, matching what `.env.example` and the README already promise. It
 * is a floor on the *search space*, not on typing effort: the signed participant
 * cookie is the whole of authorship in Jiwar — there are no accounts, so the
 * HMAC over the participant id is the only thing distinguishing the browser that
 * published a notice from any other browser asking to cancel it.
 */
const MIN_COOKIE_SECRET_LENGTH = 32;

/**
 * The literal placeholder `.env.example` used to ship, kept here as a value to
 * reject rather than as a value to suggest.
 *
 * It is 41 characters, so a length floor alone waves it straight through — and it
 * is published in this repository, which makes it a *known* secret and therefore
 * not a secret at all. Anyone who has read the repo can forge a cookie for an
 * arbitrary participant id against a deployment that kept it.
 */
const PLACEHOLDER_COOKIE_SECRETS = new Set([
  // The value `.env.example` shipped before this check existed, and therefore the
  // value any deployment predating it is most likely still running.
  "change-me-in-production-min-32-chars-long",
  // What `.env.example` holds now. It is also under the length floor, so it would
  // be rejected anyway — naming it here only buys the more specific message.
  "CHANGE_ME",
]);

/**
 * Rejects a `COOKIE_SECRET` that is present but too weak to sign with.
 *
 * `required()` only rejects an *empty* value, which left two ways to boot with an
 * effectively public secret. Both were measured against `loadConfig()` before this
 * check existed:
 *
 *   COOKIE_SECRET="x"                                          -> booted
 *   COOKIE_SECRET="change-me-in-production-min-32-chars-long"  -> booted
 *
 * The first is the dangerous one. `cookie-signature` is HMAC-SHA1 over a key the
 * attacker can brute-force offline from a single observed cookie: a one-character
 * secret is at most ~95 candidates, so recovering it and then minting
 * `jiwar_pid=<victim id>.<mac>` is the work of a moment. Since `cancel` authorises
 * purely on that cookie, forging it cancels a stranger's funeral notice. The
 * second is worse in practice than in theory — it is the value a copied
 * `.env.example` leaves behind, so it is the secret a hurried deployment is most
 * likely to be running, and it is sitting in git history.
 *
 * Failing to boot is the right response rather than a warning: a warning in a log
 * nobody reads keeps the forgeable deployment serving traffic, and there is no
 * safe degraded mode for "authorship cannot be trusted".
 */
function requireStrongCookieSecret(secret: string): string {
  if (PLACEHOLDER_COOKIE_SECRETS.has(secret)) {
    throw new Error(
      "COOKIE_SECRET is still the placeholder value shipped in .env.example. " +
        "It is published in this repository, so anyone can forge a participant cookie and cancel " +
        `another person's notice. Generate a real secret of at least ${MIN_COOKIE_SECRET_LENGTH} ` +
        "characters, for example with `openssl rand -base64 48`.",
    );
  }

  if (secret.length < MIN_COOKIE_SECRET_LENGTH) {
    throw new Error(
      `COOKIE_SECRET is too short: ${secret.length} character(s), but at least ` +
        `${MIN_COOKIE_SECRET_LENGTH} are required. It signs the participant cookie, which is the ` +
        "only proof of authorship, so a short secret can be brute-forced and used to cancel " +
        "another person's notice. Generate one with `openssl rand -base64 48`.",
    );
  }

  return secret;
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
    cookieSecret: requireStrongCookieSecret(required("COOKIE_SECRET")),
    cookieSecure,
    maxRadiusKm: Number(process.env.MAX_RADIUS_KM ?? 100),
    defaultRadiusKm: Number(process.env.DEFAULT_RADIUS_KM ?? 20),
    pastGraceHours: Number(process.env.PAST_GRACE_HOURS ?? 24),
    nominatimBaseUrl: process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org",
    nominatimUserAgent: process.env.NOMINATIM_USER_AGENT ?? "jiwar-dev/0.1",
  };
}

export const APP_CONFIG = "APP_CONFIG";
