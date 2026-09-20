import { en, type TranslationKey } from "./en.js";

const table = en;

/** Looks up a string and substitutes {placeholders}. */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const template: string = table[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    String(params[name] ?? `{${name}}`),
  );
}

export type { TranslationKey };
