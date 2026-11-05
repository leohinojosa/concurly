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
