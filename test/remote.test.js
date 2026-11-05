const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const remote = require("../dist/remote");
const { startFakeRemote, tempHome } = require("./helpers");

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
