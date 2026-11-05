import fs from "fs";
import path from "path";
import { concurlyHome } from "./paths";

/** User preferences shared across all concurly sessions/ports. Extend by adding optional fields. */
export interface Preferences {
  theme?: string;
}

const THEME_ID = /^[a-z0-9-]{1,32}$/;

export function isValidTheme(value: unknown): value is string {
  return typeof value === "string" && THEME_ID.test(value);
}

export function prefsPath(): string {
  return path.join(concurlyHome(), "preferences.json");
}

/** Keeps only known, valid fields. */
export function sanitize(input: unknown): Preferences {
  const out: Preferences = {};
  if (input && typeof input === "object") {
    const theme = (input as Record<string, unknown>).theme;
    if (isValidTheme(theme)) out.theme = theme;
  }
  return out;
}

export function readPrefs(): Preferences {
  try {
    return sanitize(JSON.parse(fs.readFileSync(prefsPath(), "utf-8")));
  } catch {
    return {};
  }
}

/** Merges `patch` into the stored preferences (atomic temp + rename) and returns the result. */
export function writePrefs(patch: unknown): Preferences {
  const next: Preferences = { ...readPrefs(), ...sanitize(patch) };
  const file = prefsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
  fs.renameSync(tmp, file);
  return next;
}
