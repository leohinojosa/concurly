const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const prefs = require("../dist/prefs");
const { createServer } = require("../dist/server");
const { tempHome } = require("./helpers");

function listen(app) {
  return new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
}

test("readPrefs: missing file → {}", () => {
  tempHome();
  assert.deepEqual(prefs.readPrefs(), {});
});

test("writePrefs: persists under CONCURLY_HOME and merges", () => {
  const home = tempHome();
  assert.deepEqual(prefs.writePrefs({ theme: "nord" }), { theme: "nord" });
  assert.equal(prefs.prefsPath(), path.join(home, "preferences.json"));
  assert.deepEqual(JSON.parse(fs.readFileSync(prefs.prefsPath(), "utf-8")), { theme: "nord" });
  assert.deepEqual(prefs.writePrefs({ theme: "ember" }), { theme: "ember" });
  assert.deepEqual(prefs.readPrefs(), { theme: "ember" });
});

test("sanitize / isValidTheme reject bad ids and unknown keys", () => {
  assert.equal(prefs.isValidTheme("paper"), true);
  assert.equal(prefs.isValidTheme("my-theme-2"), true);
  for (const bad of ["", "Paper", "has space", "../x", "a".repeat(33), 5, null, undefined]) {
    assert.equal(prefs.isValidTheme(bad), false, String(bad));
  }
  assert.deepEqual(prefs.sanitize({ theme: "bad id", other: 1 }), {});
  assert.deepEqual(prefs.sanitize("nope"), {});
});

test("readPrefs: corrupt file → {} (never throws)", () => {
  tempHome();
  fs.mkdirSync(path.dirname(prefs.prefsPath()), { recursive: true });
  fs.writeFileSync(prefs.prefsPath(), "{not json");
  assert.deepEqual(prefs.readPrefs(), {});
});

test("server: GET/PUT /preferences", async () => {
  const home = tempHome();
  const html = path.join(home, "a.html");
  const client = path.join(home, "client.js");
  fs.writeFileSync(html, "<html><body></body></html>");
  fs.writeFileSync(client, "// client");
  const srv = await listen(createServer(html, client));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const put = (body) => fetch(`${base}/preferences`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    assert.deepEqual(await (await fetch(`${base}/preferences`)).json(), {});

    let r = await put({ theme: "midnight" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { theme: "midnight" });
    assert.deepEqual(await (await fetch(`${base}/preferences`)).json(), { theme: "midnight" });

    r = await put({ theme: "Not Valid" });
    assert.equal(r.status, 400);
    r = await put({});
    assert.equal(r.status, 400);
    assert.deepEqual(await (await fetch(`${base}/preferences`)).json(), { theme: "midnight" }, "file untouched by bad PUTs");
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
