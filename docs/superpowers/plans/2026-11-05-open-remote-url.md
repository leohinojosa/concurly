# Open a Remote URL in concurly — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `concurly open <url>` fetches a remote HTML page (e.g. a GitHub raw link) into a durable local cache and starts a normal review session on it, with CLI + UI refresh that preserves comments.

**Architecture:** A new `src/remote.ts` owns URL normalization, token stripping, the cache layout (`~/.concurly/reviews/<hash>/`) and fetching. The cached copy is then treated as an ordinary local file, so `server.ts` / `store.ts` / `watcher.ts` are unchanged except for two new routes (`GET /source`, `POST /refresh`). The full URL (with any `?token=`) lives only in the running server process's memory; everything persisted or printed uses the token-stripped identity URL.

**Tech Stack:** TypeScript → CommonJS, Node 20 global `fetch`, Express 4, vanilla-JS `client.js`, `node:test` for tests (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-11-05-open-remote-url-design.md`

**Conventions:**
- Work in the `remote-url-open` worktree. All commands run from its root.
- Commit messages end with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tests run against compiled output: `npm test` = `npm run build && node --test test/`.
- `client.js` stays plain JS: no TypeScript syntax, imports or `require()`. All injected DOM uses the `__dr-` prefix.

**Additions beyond the approved spec (small, flagged):**
1. `POST /refresh` accepts an optional `{ url }` body. If its token-stripped form matches the session's source, it replaces the in-memory URL before refetching. This lets `concurly open <fresh-url>` or `concurly refresh <fresh-url>` recover a live session whose `?token=` expired (otherwise there is a dead end: the session is alive but can never refresh).
2. `CONCURLY_HOME` env var overrides `~/.concurly` (needed for isolated tests) and `CONCURLY_NO_BROWSER` skips launching a browser (needed for the CLI end-to-end test).

**Resolved open item from the spec:** `client.js` already skips badges for selectors that no longer match (`injectBadge`: `if (!el) return`), so comments stay visible in the sidebar after a refresh. No new "orphaned" state is built here. It is noted as a follow-up.

---

## Chunk 1: Core library and server

### Task 0: Install dependencies and add the test script

**Files:**
- Modify: `package.json` (scripts)

- [ ] **Step 1: Install dependencies**

Run: `npm install`
Expected: installs without errors; `node_modules/` appears.

- [ ] **Step 2: Add the test script**

In `package.json` `"scripts"`, add after `"start"`:

```json
    "start": "node dist/cli.js",
    "test": "npm run build && node --test test/"
```

(Add the comma after the `start` line.)

- [ ] **Step 3: Verify the baseline build passes**

Run: `npm run build`
Expected: exits 0; `dist/cli.js` and `dist/client.js` exist.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add npm test script (node:test)"
```

---

### Task 1: `remote.ts` pure helpers

**Files:**
- Create: `src/remote.ts`
- Create: `test/helpers.js`
- Create: `test/remote.test.js`

- [ ] **Step 1: Write the shared test helpers**

Create `test/helpers.js`:

```js
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Tiny fake remote. Mutate `state.status` / `state.body` between requests.
function startFakeRemote() {
  const state = { status: 200, body: "<html><body><h1>v1</h1></body></html>", hits: [] };
  const server = http.createServer((req, res) => {
    state.hits.push(req.url);
    res.statusCode = state.status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(state.status === 200 ? state.body : "nope");
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        state,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections();
            server.close(r);
          }),
      });
    });
  });
}

// Isolated CONCURLY_HOME so tests never touch the real ~/.concurly.
function tempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "concurly-test-"));
  process.env.CONCURLY_HOME = dir;
  return dir;
}

module.exports = { startFakeRemote, tempHome };
```

- [ ] **Step 2: Write the failing tests for the pure helpers**

Create `test/remote.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const remote = require("../dist/remote");
const { tempHome } = require("./helpers");

test("isUrl accepts http(s) only", () => {
  assert.equal(remote.isUrl("https://x.com/a.html"), true);
  assert.equal(remote.isUrl("HTTP://x.com/a.html"), true);
  assert.equal(remote.isUrl("C:\\files\\a.html"), false);
  assert.equal(remote.isUrl("a.html"), false);
});

test("normalizeUrl rewrites github blob links to raw.githubusercontent.com", () => {
  assert.equal(
    remote.normalizeUrl("https://github.com/o/r/blob/main/docs/a.html?raw=true"),
    "https://raw.githubusercontent.com/o/r/main/docs/a.html"
  );
  const raw = "https://raw.githubusercontent.com/o/r/main/a.html?token=ABC";
  assert.equal(remote.normalizeUrl(raw), raw);
  assert.equal(remote.normalizeUrl("https://example.com/a.html#frag"), "https://example.com/a.html");
});

test("stripSecrets removes token but keeps other query params", () => {
  assert.equal(
    remote.stripSecrets("https://raw.githubusercontent.com/o/r/main/a.html?token=ABC"),
    "https://raw.githubusercontent.com/o/r/main/a.html"
  );
  assert.equal(
    remote.stripSecrets("https://example.com/a.html?v=2&token=ABC"),
    "https://example.com/a.html?v=2"
  );
});

test("isPinnedUrl is true only for a 40-hex ref on raw.githubusercontent.com", () => {
  const sha = "a0b0f974d10bedabe405ab3477d2f390a920d042";
  assert.equal(remote.isPinnedUrl(`https://raw.githubusercontent.com/o/r/${sha}/a.html`), true);
  assert.equal(remote.isPinnedUrl("https://raw.githubusercontent.com/o/r/main/a.html"), false);
  assert.equal(remote.isPinnedUrl(`https://example.com/o/r/${sha}/a.html`), false);
});

test("reviewDir is stable across token rotation and under CONCURLY_HOME", () => {
  const home = tempHome();
  const base = "https://raw.githubusercontent.com/o/r/main/a.html";
  const a = remote.reviewDir(remote.stripSecrets(`${base}?token=AAA`));
  const b = remote.reviewDir(remote.stripSecrets(`${base}?token=BBB`));
  assert.equal(a, b);
  assert.ok(a.startsWith(path.join(home, "reviews")));
});

test("cachedHtmlPath names the file from the URL basename", () => {
  tempHome();
  assert.equal(path.basename(remote.cachedHtmlPath("http://x/a/design.html")), "design.html");
  assert.equal(path.basename(remote.cachedHtmlPath("http://x/a/readme")), "readme.html");
  assert.equal(path.basename(remote.cachedHtmlPath("http://x/")), "page.html");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: build fails or tests FAIL with `Cannot find module '../dist/remote'`.

- [ ] **Step 4: Implement the helpers**

Create `src/remote.ts`:

```ts
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const MAX_BYTES = 20 * 1024 * 1024;
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
  const home = process.env.CONCURLY_HOME ?? path.join(os.homedir(), ".concurly");
  return path.join(home, "reviews");
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

// fetchRemote is added in Task 2.
export { MAX_BYTES, FETCH_TIMEOUT_MS };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all tests in `remote.test.js` PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/remote.ts test/helpers.js test/remote.test.js
git commit -m "feat: add remote URL helpers (normalize, strip token, cache layout)"
```

---

### Task 2: `fetchRemote`

**Files:**
- Modify: `src/remote.ts` (replace the trailing placeholder export)
- Modify: `test/remote.test.js` (append tests)

- [ ] **Step 1: Append the failing tests**

Append to `test/remote.test.js` (also add `const fs = require("fs");` and `startFakeRemote` to the existing requires at the top: `const { startFakeRemote, tempHome } = require("./helpers");`):

```js
test("fetchRemote: updated, then unchanged, then updated; writes source.json", async () => {
  tempHome();
  const fake = await startFakeRemote();
  try {
    const full = `${fake.base}/docs/design.html?token=SECRET`;
    const identity = remote.stripSecrets(remote.normalizeUrl(full));

    let r = await remote.fetchRemote(full);
    assert.equal(r.status, "updated");
    assert.match(fs.readFileSync(remote.cachedHtmlPath(identity), "utf-8"), /v1/);

    const meta = remote.readSourceMeta(identity);
    assert.equal(meta.sourceUrl, identity);
    assert.ok(!JSON.stringify(meta).includes("SECRET"));

    r = await remote.fetchRemote(full);
    assert.equal(r.status, "unchanged");

    fake.state.body = "<html><body>v2</body></html>";
    r = await remote.fetchRemote(full);
    assert.equal(r.status, "updated");
    assert.match(fs.readFileSync(remote.cachedHtmlPath(identity), "utf-8"), /v2/);
  } finally {
    await fake.close();
  }
});

test("fetchRemote: 404 throws RemoteError with hint, leaves cache, never leaks token", async () => {
  tempHome();
  const fake = await startFakeRemote();
  try {
    const full = `${fake.base}/a.html?token=SECRET`;
    const identity = remote.stripSecrets(full);
    await remote.fetchRemote(full);

    fake.state.status = 404;
    await assert.rejects(
      () => remote.fetchRemote(full),
      (err) => {
        assert.ok(err instanceof remote.RemoteError);
        assert.equal(err.status, 404);
        assert.match(err.message, /fresh Raw link/);
        assert.ok(!err.message.includes("SECRET"));
        return true;
      }
    );
    assert.match(fs.readFileSync(remote.cachedHtmlPath(identity), "utf-8"), /v1/);
  } finally {
    await fake.close();
  }
});

test("fetchRemote: rejects oversized responses", async () => {
  tempHome();
  const fake = await startFakeRemote();
  try {
    fake.state.body = "x".repeat(remote.MAX_BYTES + 1);
    await assert.rejects(() => remote.fetchRemote(`${fake.base}/big.html`), /too large/i);
  } finally {
    await fake.close();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the three new tests FAIL with `remote.fetchRemote is not a function`.

- [ ] **Step 3: Implement `fetchRemote`**

In `src/remote.ts`, replace the last two lines (`// fetchRemote is added in Task 2.` and `export { MAX_BYTES, FETCH_TIMEOUT_MS };`) with:

```ts
export { MAX_BYTES };

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

  const tooLarge = new RemoteError(`Response too large (limit ${MAX_BYTES / 1024 / 1024} MB): ${identity}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw tooLarge;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw tooLarge;

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const dir = reviewDir(identity);
  fs.mkdirSync(dir, { recursive: true });

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all `remote.test.js` tests PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/remote.ts test/remote.test.js
git commit -m "feat: add fetchRemote with change detection and token-safe errors"
```

---

### Task 3: Server routes `GET /source` and `POST /refresh`

**Files:**
- Modify: `src/server.ts:1-21` (imports, signature) and before `return app;` at line 107
- Create: `test/server.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/server.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const remote = require("../dist/remote");
const { createServer } = require("../dist/server");
const { startFakeRemote, tempHome } = require("./helpers");

function listen(app) {
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

function post(base, body) {
  return fetch(`${base}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

test("remote session: /source and /refresh", async () => {
  const home = tempHome();
  const fake = await startFakeRemote();
  const fullUrl = `${fake.base}/docs/design.html?token=OLD`;
  const identity = remote.stripSecrets(remote.normalizeUrl(fullUrl));
  await remote.fetchRemote(fullUrl);

  const clientPath = path.join(home, "client.js");
  fs.writeFileSync(clientPath, "// client");
  const htmlPath = remote.cachedHtmlPath(identity);
  const srv = await listen(createServer(htmlPath, clientPath, { fullUrl }));
  const base = `http://127.0.0.1:${srv.address().port}`;

  try {
    const src = await (await fetch(`${base}/source`)).json();
    assert.equal(src.sourceUrl, identity);
    assert.equal(src.isPinned, false);
    assert.ok(!JSON.stringify(src).includes("OLD"));

    let r = await post(base);
    assert.equal((await r.json()).status, "unchanged");

    fake.state.body = "<html><body>v2</body></html>";
    r = await post(base);
    assert.equal((await r.json()).status, "updated");
    assert.match(fs.readFileSync(htmlPath, "utf-8"), /v2/);

    fake.state.status = 404;
    r = await post(base);
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /fresh Raw link/);

    // Fresh token for the same source replaces the in-memory URL.
    fake.state.status = 200;
    r = await post(base, { url: `${fake.base}/docs/design.html?token=NEW` });
    assert.equal(r.status, 200);
    assert.ok(fake.state.hits.at(-1).includes("token=NEW"));

    // A different source is rejected.
    r = await post(base, { url: `${fake.base}/other.html` });
    assert.equal(r.status, 400);
  } finally {
    srv.closeAllConnections();
    srv.close();
    await fake.close();
  }
});

test("local session: /source and /refresh return 404", async () => {
  const home = tempHome();
  const htmlPath = path.join(home, "a.html");
  const clientPath = path.join(home, "client.js");
  fs.writeFileSync(htmlPath, "<html><body></body></html>");
  fs.writeFileSync(clientPath, "// client");
  const srv = await listen(createServer(htmlPath, clientPath));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${base}/source`)).status, 404);
    assert.equal((await post(base)).status, 404);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: `server.test.js` FAILS (`/source` returns 404 for the remote session because the route doesn't exist yet).

- [ ] **Step 3: Implement the routes**

In `src/server.ts`, add after the existing `import type { Comment } from "./store";` line:

```ts
import {
  fetchRemote,
  isPinnedUrl,
  isUrl,
  normalizeUrl,
  readSourceMeta,
  RemoteError,
  stripSecrets,
} from "./remote";

/** Mutable holder so a fresh `?token=` URL can replace an expired one at runtime. */
export interface RemoteSource {
  fullUrl: string;
}
```

Change the signature (`src/server.ts:16`):

```ts
export function createServer(htmlPath: string, clientScriptPath: string, source?: RemoteSource) {
```

Insert before `return app;` (after the `app.delete("/comments/:id", ...)` block):

```ts
  app.get("/source", (_req, res) => {
    if (!source) {
      res.status(404).json({ error: "not a remote session" });
      return;
    }
    const sourceUrl = stripSecrets(normalizeUrl(source.fullUrl));
    res.json({
      sourceUrl,
      fetchedAt: readSourceMeta(sourceUrl)?.fetchedAt ?? null,
      isPinned: isPinnedUrl(sourceUrl),
    });
  });

  app.post("/refresh", async (req, res) => {
    if (!source) {
      res.status(404).json({ error: "not a remote session" });
      return;
    }
    const { url } = (req.body ?? {}) as { url?: unknown };
    try {
      if (url !== undefined) {
        if (typeof url !== "string" || !isUrl(url)) throw new Error("url must be an http(s) URL");
        const sameSource =
          stripSecrets(normalizeUrl(url)) === stripSecrets(normalizeUrl(source.fullUrl));
        if (!sameSource) throw new Error("url must be the same source as this session");
        source.fullUrl = normalizeUrl(url);
      }
      res.json(await fetchRemote(source.fullUrl));
    } catch (err) {
      res.status(err instanceof RemoteError ? 502 : 400).json({ error: (err as Error).message });
    }
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts test/server.test.js
git commit -m "feat: add /source and /refresh endpoints for remote sessions"
```

---

## Chunk 2: CLI, UI, docs

### Task 4: CLI — open a URL, `refresh`, state, list/review

**Files:**
- Modify: `src/cli.ts` (imports; `State`; `resolveInstance` ~line 59; `openBrowser` ~line 66; `cmdOpen` lines 73-166; `cmdList`; `cmdReview`; new `cmdRefresh`; `printHelp`; `main`)
- Create: `test/cli.e2e.test.js`

- [ ] **Step 1: Write the failing end-to-end test**

Create `test/cli.e2e.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { startFakeRemote, tempHome } = require("./helpers");

const CLI = path.join(__dirname, "..", "dist", "cli.js");

function runCli(args, env) {
  return spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf-8" });
}

test("cli: open remote URL, list, review, refresh, expired link, complete", async () => {
  const home = tempHome();
  const fake = await startFakeRemote();
  const env = { ...process.env, CONCURLY_HOME: home, CONCURLY_NO_BROWSER: "1" };
  const url = `${fake.base}/docs/design.html?token=SECRET1`;

  const child = spawn(process.execPath, [CLI, "open", url], { env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for server:\n${out}`)), 10000);
    const iv = setInterval(() => {
      const m = out.match(/running on http:\/\/localhost:(\d+)/);
      if (m) {
        clearTimeout(timer);
        clearInterval(iv);
        resolve(m[1]);
      }
    }, 50);
  });

  try {
    assert.ok(!out.includes("SECRET1"), "token must not be printed");
    assert.match(out, /Source:\s+http:\/\/127\.0\.0\.1:\d+\/docs\/design\.html\r?\n/);

    const stateFile = path.join(os.tmpdir(), "concurly-instances", `${port}.json`);
    assert.ok(!fs.readFileSync(stateFile, "utf-8").includes("SECRET1"), "token must not hit disk");

    const list = runCli(["list"], env);
    assert.ok(list.stdout.includes("design.html"));
    assert.ok(!list.stdout.includes("SECRET1"));

    const review = JSON.parse(runCli(["review", port], env).stdout);
    assert.match(review.sourceUrl, /design\.html$/);

    let r = runCli(["refresh", port], env);
    assert.match(r.stdout, /No changes/);

    fake.state.body = "<html><body>v2</body></html>";
    r = runCli(["refresh", port], env);
    assert.match(r.stdout, /Updated/);

    fake.state.status = 404; // simulate an expired token
    r = runCli(["refresh", port], env);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /fresh Raw link/);

    fake.state.status = 200; // recover with a fresh link
    r = runCli(["refresh", `${fake.base}/docs/design.html?token=SECRET2`], env);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fake.state.hits.some((h) => h.includes("SECRET2")));
  } finally {
    runCli(["complete", port], env);
    child.kill();
    await fake.close();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: the e2e test FAILS (the CLI treats the URL as a missing file, or `refresh` is an unknown command).

- [ ] **Step 3: Update imports, `State`, `resolveInstance`, `openBrowser`**

`src/cli.ts` imports: add after the `createWatcher` import:

```ts
import {
  cachedHtmlPath,
  fetchRemote,
  isUrl,
  normalizeUrl,
  stripSecrets,
} from "./remote";
import type { RemoteSource } from "./server";
```

`State` interface, add the field:

```ts
interface State {
  htmlPath: string;
  storePath: string;
  sourceUrl?: string; // token-stripped; present for remote sessions only
  port: number;
  pid: number;
  startedAt: string;
}
```

Replace `resolveInstance`:

```ts
function resolveInstance(target: string, instances: State[]): State | null {
  const byPort = instances.find((i) => String(i.port) === target);
  if (byPort) return byPort;
  if (isUrl(target)) {
    try {
      const identity = stripSecrets(normalizeUrl(target));
      return instances.find((i) => i.sourceUrl === identity) ?? null;
    } catch {
      return null;
    }
  }
  const abs = path.resolve(target);
  return instances.find((i) => i.htmlPath === abs) ?? null;
}
```

Replace `openBrowser`:

```ts
async function openBrowser(url: string): Promise<void> {
  if (process.env.CONCURLY_NO_BROWSER) return; // used by tests
  const { default: open } = await import("open");
  await open(url);
}

async function requestRefresh(
  port: number,
  fullUrl?: string
): Promise<{ status: string; fetchedAt: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fullUrl ? { url: fullUrl } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json()) as { status?: string; fetchedAt?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as { status: string; fetchedAt: string };
}
```

- [ ] **Step 4: Rewrite the head of `cmdOpen`**

Replace everything from `async function cmdOpen` through the end of the `if (existing) { ... }` block (current lines 73-96) with:

```ts
async function cmdOpen(args: string[]): Promise<void> {
  const target = args[0];
  if (!target) {
    console.error("Usage: concurly open <file.html | url>");
    process.exit(1);
  }

  let htmlPath: string;
  let remote: RemoteSource | undefined;
  let sourceUrl: string | undefined;

  if (isUrl(target)) {
    let fullUrl: string;
    try {
      fullUrl = normalizeUrl(target);
    } catch {
      console.error(`Invalid URL: ${target}`);
      process.exit(1);
    }
    sourceUrl = stripSecrets(fullUrl);
    htmlPath = cachedHtmlPath(sourceUrl);
    remote = { fullUrl }; // full URL (with any ?token=) stays in memory only
  } else {
    htmlPath = path.resolve(target);
    if (!fs.existsSync(htmlPath)) {
      console.error(`File not found: ${htmlPath}`);
      process.exit(1);
    }
  }

  // Re-use an existing live instance for the same file / source.
  const existing = readAllInstances().find(
    (i) => i.htmlPath === htmlPath && isAlive(i.pid)
  );
  if (existing) {
    const url = `http://localhost:${existing.port}`;
    console.log(`Instance already running for this file on port ${existing.port}`);
    if (remote) {
      // Hand the (possibly fresher) URL to the live session and refetch.
      try {
        const r = await requestRefresh(existing.port, remote.fullUrl);
        console.log(r.status === "updated" ? "Refetched: page updated" : "Refetched: no changes");
      } catch (err) {
        console.warn(`Warning: couldn't refetch (${(err as Error).message})`);
      }
    }
    console.log(`Opening: ${url}`);
    await openBrowser(url);
    return;
  }

  if (remote) {
    try {
      await fetchRemote(remote.fullUrl);
    } catch (err) {
      if (!fs.existsSync(htmlPath)) {
        console.error((err as Error).message);
        process.exit(1);
      }
      console.warn(`Warning: couldn't refetch (${(err as Error).message}). Opening stale cached copy.`);
    }
  }
```

- [ ] **Step 5: Thread `remote` / `sourceUrl` through the rest of `cmdOpen`**

Change `const app = createServer(htmlPath, tmpClientPath);` to:

```ts
  const app = createServer(htmlPath, tmpClientPath, remote);
```

Change the `writeInstanceState` call to:

```ts
    writeInstanceState({ htmlPath, storePath, sourceUrl, port, pid: process.pid, startedAt: new Date().toISOString() });
```

After `console.log(\`File:     ${htmlPath}\`);` add:

```ts
    if (sourceUrl) console.log(`Source:   ${sourceUrl}`);
```

- [ ] **Step 6: Update `cmdList` and `cmdReview`**

In `cmdList`, after the `File:` line add:

```ts
    if (inst.sourceUrl) console.log(`  Source:   ${inst.sourceUrl}`);
```

In `cmdReview`, replace the `process.stdout.write(...)` call with:

```ts
  process.stdout.write(
    JSON.stringify(
      {
        htmlFile: inst.htmlPath,
        ...(inst.sourceUrl ? { sourceUrl: inst.sourceUrl } : {}),
        port: inst.port,
        openComments: open,
      },
      null,
      2
    ) + "\n"
  );
```

- [ ] **Step 7: Add `cmdRefresh`, help text, and dispatch**

Add before the `// ─── help` section:

```ts
// ─── refresh ─────────────────────────────────────────────────────────────────

async function cmdRefresh(args: string[]): Promise<void> {
  const target = args[0];
  const inst = pickInstance(target);
  if (!inst.sourceUrl) {
    console.error("This session is a local file; nothing to refresh.");
    process.exit(1);
  }

  // A URL argument may carry a fresh ?token= to replace an expired one.
  const freshUrl = target && isUrl(target) ? normalizeUrl(target) : undefined;
  try {
    const r = await requestRefresh(inst.port, freshUrl);
    console.log(
      r.status === "updated"
        ? `Updated from ${inst.sourceUrl} (fetched ${r.fetchedAt})`
        : `No changes (checked ${r.fetchedAt})`
    );
  } catch (err) {
    console.error(`Couldn't refetch: ${(err as Error).message}`);
    process.exit(1);
  }
}
```

In `printHelp`, replace the `open` line and add `refresh`:

```
  concurly open <file.html | url>        Open a design file or remote HTML URL (one instance per file/URL)
  concurly refresh [port|url]            Refetch a remote page; a URL with a fresh ?token= replaces an expired link
```

(Keep the other lines; place `refresh` after `complete`.)

In `main`, replace the shorthand condition and add the dispatch:

```ts
  // `concurly <file.html | url>` shorthand defaults to open.
  if (isUrl(cmd) || cmd.endsWith(".html") || cmd.endsWith(".htm")) {
    await cmdOpen([cmd, ...rest]);
    return;
  }
```

and after the `complete` line:

```ts
  if (cmd === "refresh") { await cmdRefresh(rest); return; }
```

Also update the two "Run: concurly open <file.html>" hints (`cmdComplete`, `pickInstance`) to `<file.html | url>`.

- [ ] **Step 8: Run all tests**

Run: `npm test`
Expected: all PASS, including `cli.e2e.test.js`. If the e2e test times out, the printed `out` shows the CLI's output.

- [ ] **Step 9: Commit**

```bash
git add src/cli.ts test/cli.e2e.test.js
git commit -m "feat: open remote URLs and add refresh command"
```

---

### Task 5: Browser UI — source label, fetched time, Refresh button

**Files:**
- Modify: `src/client.js` (CSS in `injectStyles` after line 181; new function before `// ─── Tab bar`; init call at line 1068)

No automated test (browser UI; repo has no DOM test setup). Verified manually in Step 4.

- [ ] **Step 1: Add the CSS**

In `injectStyles()`, after the line `#__dr-header-github__ svg { width: 14px; height: 14px; }` add:

```css
      #__dr-header-remote__ {
        display: flex; align-items: center; gap: 8px;
        flex-shrink: 0; margin-left: 8px;
      }
      #__dr-header-fetched__, #__dr-header-pinned__ { color: #71717a; font-size: 11px; }
      #__dr-header-refresh__ {
        background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46;
        border-radius: 5px; padding: 3px 10px; font-size: 12px;
        font-family: inherit; cursor: pointer;
      }
      #__dr-header-refresh__:hover:not(:disabled) { background: #3f3f46; }
      #__dr-header-refresh__:disabled { opacity: 0.6; cursor: default; }
      #__dr-header-refresh-status__ {
        color: #a1a1aa; font-size: 11px; max-width: 360px;
        overflow: hidden; text-overflow: ellipsis;
      }
      #__dr-header-refresh-status__.__dr-error__ { color: #f87171; }
```

- [ ] **Step 2: Add the remote-controls function**

Insert immediately before the `// ─── Tab bar ───` comment (after `injectHeader`'s closing brace):

```js
  // ─── Remote source controls (remote sessions only) ────────────────────────
  function timeAgo(iso) {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 48) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  async function initRemoteControls() {
    let info;
    try {
      const res = await fetch(`http://localhost:${PORT}/source`, { cache: "no-store" });
      if (!res.ok) return; // local-file session: no remote controls
      info = await res.json();
    } catch {
      return;
    }

    const header = document.getElementById("__dr-header__");
    const versionEl = document.getElementById("__dr-header-version__");
    if (!header || !versionEl) return;

    // Show the source URL instead of the cache path.
    const pathEl = document.getElementById("__dr-header-path__");
    if (pathEl) {
      pathEl.textContent = info.sourceUrl;
      pathEl.title = info.sourceUrl;
    }

    const wrap = document.createElement("span");
    wrap.id = "__dr-header-remote__";

    const fetched = document.createElement("span");
    fetched.id = "__dr-header-fetched__";
    const renderFetched = () => {
      fetched.textContent = info.fetchedAt ? "fetched " + timeAgo(info.fetchedAt) : "";
    };
    renderFetched();
    setInterval(renderFetched, 30000);
    wrap.appendChild(fetched);

    if (info.isPinned) {
      const pinned = document.createElement("span");
      pinned.id = "__dr-header-pinned__";
      pinned.textContent = "pinned to commit";
      wrap.appendChild(pinned);
    } else {
      const btn = document.createElement("button");
      btn.id = "__dr-header-refresh__";
      btn.textContent = "↻ Refresh";

      const status = document.createElement("span");
      status.id = "__dr-header-refresh-status__";

      btn.addEventListener("click", async () => {
        btn.disabled = true;
        status.className = "";
        status.textContent = "Refetching…";
        status.title = "";
        try {
          const res = await fetch(`http://localhost:${PORT}/refresh`, { method: "POST" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
          info.fetchedAt = data.fetchedAt;
          renderFetched();
          status.textContent = data.status === "unchanged" ? "No changes" : "Updated";
          setTimeout(() => { status.textContent = ""; }, 3000);
        } catch (err) {
          status.className = "__dr-error__";
          status.textContent = "Couldn't refetch: " + err.message;
          status.title = err.message;
        } finally {
          btn.disabled = false;
        }
      });

      wrap.appendChild(btn);
      wrap.appendChild(status);
    }

    header.insertBefore(wrap, versionEl);
  }
```

- [ ] **Step 3: Call it from the init block**

In the `// ─── Init` block, after `injectHeader();` add:

```js
  initRemoteControls();
```

- [ ] **Step 4: Build and manually verify**

Run: `npm run build`
Then, in one terminal, serve a fake remote:

```powershell
mkdir $env:TEMP\fake-remote -Force; Set-Content $env:TEMP\fake-remote\design.html '<html><body><h1 id="t">v1</h1></body></html>'
cd $env:TEMP\fake-remote; python -m http.server 8765
```

In another terminal (from the worktree root):

```powershell
$env:CONCURLY_HOME = "$env:TEMP\concurly-manual"
node dist/cli.js open "http://127.0.0.1:8765/design.html?token=ABC"
```

Expected in the browser:
- Header shows the URL (no `token=`), "fetched just now", and a `↻ Refresh` button.
- Click Refresh → "No changes". Edit `design.html` (change `v1` to `v2`), click Refresh → "Updated", page reloads showing `v2`, and any comments added earlier are still in the sidebar.
- Stop the python server, click Refresh → red "Couldn't refetch: Network error…".
- Restart python server with the file removed (or serve an empty dir) → 404 → red "Couldn't refetch: HTTP 404 … fresh Raw link".
- `node dist/cli.js complete` then confirm `$env:CONCURLY_HOME\reviews\<hash>\design.comments.json` still exists.
- `node dist/cli.js open .\some-local.html` → no Refresh button, header unchanged (local behavior intact).
- Open a `.../<40-hex-sha>/...` raw-style URL (any server path of that shape) → shows "pinned to commit" and no button.

- [ ] **Step 5: Commit**

```bash
git add src/client.js
git commit -m "feat: add remote source label and Refresh button to header"
```

---

### Task 6: Documentation

**Files:**
- Modify: `skills/concurly/SKILL.md`, `README.md`, `CLAUDE.md`

Read each file first and follow its existing structure; the content below is what must be added.

- [ ] **Step 1: `CLAUDE.md`**
  - Project structure: add `src/remote.ts ← URL normalization, token stripping, review-folder cache layout, fetchRemote` and `test/` (`node:test`; run `npm test`).
  - CLI Commands: `open <file.html | url>`; add `concurly refresh [port|url]`.
  - State file shape: add optional `"sourceUrl"` (token-stripped).
  - REST API table: add `GET /source` and `POST /refresh` (optional `{ url }` body replaces the in-memory URL if it is the same source).
  - New "Remote sources" section: cache at `~/.concurly/reviews/<sha1(identityUrl)[0:12]>/` (`<name>.html`, `<name>.comments.json`, `source.json`); `CONCURLY_HOME` and `CONCURLY_NO_BROWSER` env vars; **the `?token=` is never persisted or printed**; no credentials are added by concurly; refresh with an expired link fails and keeps cache + comments.
  - Key Conventions: "Never write or print a URL containing `?token=`; use `stripSecrets()`."

- [ ] **Step 2: `README.md`**
  Add a "Reviewing a remote page" section: `concurly open https://raw.githubusercontent.com/...?token=...`, `blob/` links are rewritten, the Refresh button / `concurly refresh`, that expired links need a fresh "Raw" link via `concurly open <fresh-url>` or `concurly refresh <fresh-url>`, comments stored under `~/.concurly/reviews/`.

- [ ] **Step 3: `skills/concurly/SKILL.md`**
  Document `/concurly open <file.html | url>` and `/concurly refresh [port|url]`; note that `concurly review` output now includes `sourceUrl` for remote sessions; remind the agent to run `concurly open <url>` as a background process like the file variant.

- [ ] **Step 4: Verify and commit**

Run: `npm test`
Expected: all PASS.

```bash
git add CLAUDE.md README.md skills/concurly/SKILL.md
git commit -m "docs: document remote URL support and refresh"
```

---

## Final verification (before handing off)

- [ ] `npm test` passes (remote, server, CLI e2e).
- [ ] Manual UI checks from Task 5 Step 4 done.
- [ ] `git grep -n "token" src/` shows `token` handled only via `stripSecrets` and the error/UI strings (no code path persists or logs the full URL).
- [ ] Local-file flow unchanged: `node dist/cli.js open <local.html>` works and shows no remote controls.

## Follow-ups (not in this change)
- Orphaned comments (selector no longer matches after a refresh) are only invisible-as-badges today; consider an explicit "can't locate in page" state in the sidebar.
