const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { startFakeRemote, tempHome } = require("./helpers");

const CLI = path.join(__dirname, "..", "dist", "cli.js");

// Async on purpose: the fake remote lives in this process, so a blocking
// spawnSync would stall its event loop while the CLI's server waits on it.
function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env, encoding: "utf-8" }, (err, stdout, stderr) => {
      resolve({ status: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
  });
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

  let port;
  try {
    port = await new Promise((resolve, reject) => {
      let timer;
      let iv;
      const done = (fn, value) => {
        clearTimeout(timer);
        clearInterval(iv);
        fn(value);
      };
      timer = setTimeout(() => done(reject, new Error(`timeout waiting for server:\n${out}`)), 10000);
      child.on("exit", () => done(reject, new Error(`CLI exited before serving:\n${out}`)));
      iv = setInterval(() => {
        // Wait for the last startup line (PID) so every earlier line has arrived.
        const m = out.match(/running on http:\/\/localhost:(\d+)[\s\S]*PID:\s+\d+/);
        if (m) done(resolve, m[1]);
      }, 50);
    });

    assert.ok(!out.includes("SECRET1"), "token must not be printed");
    assert.match(out, /Source:\s+http:\/\/127\.0\.0\.1:\d+\/docs\/design\.html\r?\n/);

    const stateFile = path.join(os.tmpdir(), "concurly-instances", `${port}.json`);
    assert.ok(!fs.readFileSync(stateFile, "utf-8").includes("SECRET1"), "token must not hit disk");

    const list = await runCli(["list"], env);
    assert.ok(list.stdout.includes("design.html"));
    assert.ok(!list.stdout.includes("SECRET1"));

    const review = JSON.parse((await runCli(["review", port], env)).stdout);
    assert.match(review.sourceUrl, /design\.html$/);

    let r = await runCli(["refresh", port], env);
    assert.match(r.stdout, /No changes/, `stderr: ${r.stderr}`);

    fake.state.body = "<html><body>v2</body></html>";
    r = await runCli(["refresh", port], env);
    assert.match(r.stdout, /Updated/, `stderr: ${r.stderr}`);

    fake.state.status = 404; // simulate an expired token
    r = await runCli(["refresh", port], env);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /fresh Raw link/);

    fake.state.status = 200; // recover with a fresh link
    r = await runCli(["refresh", `${fake.base}/docs/design.html?token=SECRET2`], env);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fake.state.hits.some((h) => h.includes("SECRET2")));
  } finally {
    if (port) await runCli(["complete", port], env);
    child.removeAllListeners("exit");
    child.kill();
    await fake.close();
  }
});
