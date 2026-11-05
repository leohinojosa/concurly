import crypto from "crypto";
import fs from "fs";
import path from "path";
import { concurlyHome } from "./paths";

export const MAX_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export class RemoteError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "RemoteError";
  }
}

export interface SourceMeta {
  sourceUrl: string; // token-stripped identity URL
  fetchedAt: string; // ISO 8601
  sha256: string;
}

export interface FetchResult {
  status: "updated" | "unchanged";
  fetchedAt: string;
  sha256: string;
}

export function isUrl(arg: string): boolean {
  return /^https?:\/\//i.test(arg);
}

/** Rewrites github.com blob links to raw.githubusercontent.com and drops the fragment. */
export function normalizeUrl(input: string): string {
  const u = new URL(input);
  if (u.hostname === "github.com") {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (m) {
      u.hostname = "raw.githubusercontent.com";
      u.pathname = `/${m[1]}/${m[2]}/${m[3]}`;
      u.searchParams.delete("raw");
    }
  }
  u.hash = "";
  return u.toString();
}

/** The identity URL: no `token` param. Safe to persist, hash, and print. */
export function stripSecrets(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("token");
  u.hash = "";
  return u.toString();
}

/** True when the ref segment is a 40-char commit SHA (content can never change). */
export function isPinnedUrl(url: string): boolean {
  const u = new URL(url);
  if (u.hostname !== "raw.githubusercontent.com") return false;
  return /^[0-9a-f]{40}$/i.test(u.pathname.split("/")[3] ?? "");
}

export function reviewsRoot(): string {
  return path.join(concurlyHome(), "reviews");
}

export function reviewDir(identityUrl: string): string {
  const hash = crypto.createHash("sha1").update(identityUrl).digest("hex").slice(0, 12);
  return path.join(reviewsRoot(), hash);
}

function cacheFileName(identityUrl: string): string {
  let raw = new URL(identityUrl).pathname.split("/").pop() ?? "";
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* keep undecoded */
  }
  const safe = raw.replace(/[^\w.\- ]/g, "_");
  if (!safe) return "page.html";
  return /\.html?$/i.test(safe) ? safe : `${safe}.html`;
}

export function cachedHtmlPath(identityUrl: string): string {
  return path.join(reviewDir(identityUrl), cacheFileName(identityUrl));
}

function metaPath(identityUrl: string): string {
  return path.join(reviewDir(identityUrl), "source.json");
}

export function readSourceMeta(identityUrl: string): SourceMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath(identityUrl), "utf-8")) as SourceMeta;
  } catch {
    return null;
  }
}

/**
 * Fetches `fullUrl` (which may carry a `?token=`) and stores it in the review
 * folder. No credentials are added. Writes the HTML only when the content
 * changed (atomic temp+rename). Error messages use the token-stripped URL.
 */
export async function fetchRemote(fullUrl: string): Promise<FetchResult> {
  const requestUrl = normalizeUrl(fullUrl);
  const identity = stripSecrets(requestUrl);

  let res: Response;
  try {
    res = await fetch(requestUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new RemoteError(`Network error fetching ${identity}: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const hint = [401, 403, 404].includes(res.status)
      ? " — link expired or not accessible (use a fresh Raw link)"
      : "";
    throw new RemoteError(`HTTP ${res.status} fetching ${identity}${hint}`, res.status);
  }

  const tooLarge = new RemoteError(
    `Response too large (limit ${MAX_BYTES / 1024 / 1024} MB): ${identity}`
  );
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw tooLarge;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw tooLarge;

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  fs.mkdirSync(reviewDir(identity), { recursive: true });

  const dest = cachedHtmlPath(identity);
  const unchanged = readSourceMeta(identity)?.sha256 === sha256 && fs.existsSync(dest);
  if (!unchanged) {
    const tmp = `${dest}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, dest);
  }

  const fetchedAt = new Date().toISOString();
  const meta: SourceMeta = { sourceUrl: identity, fetchedAt, sha256 };
  fs.writeFileSync(metaPath(identity), JSON.stringify(meta, null, 2), "utf-8");

  return { status: unchanged ? "unchanged" : "updated", fetchedAt, sha256 };
}
