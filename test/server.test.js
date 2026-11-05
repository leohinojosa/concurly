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
