#!/usr/bin/env node
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { WebSocketServer } from "ws";
import { createServer, findFreePort } from "./server";
import { getStorePath, readComments, resolveComment } from "./store";
import { createWatcher } from "./watcher";

// One JSON file per running instance, keyed by port number.
const STATE_DIR = path.join(os.tmpdir(), "concurly-instances");

interface State {
  htmlPath: string;
  storePath: string;
  port: number;
  pid: number;
  startedAt: string;
}

function stateFilePath(port: number): string {
  return path.join(STATE_DIR, `${port}.json`);
}

function writeInstanceState(state: State): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFilePath(state.port), JSON.stringify(state, null, 2), "utf-8");
}

function removeInstanceState(port: number): void {
  const f = stateFilePath(port);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

function readAllInstances(): State[] {
  if (!fs.existsSync(STATE_DIR)) return [];
  return fs
    .readdirSync(STATE_DIR)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      try {
        return [JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), "utf-8")) as State];
      } catch {
        return [];
      }
    });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveInstance(target: string, instances: State[]): State | null {
  const byPort = instances.find((i) => String(i.port) === target);
  if (byPort) return byPort;
  const abs = path.resolve(target);
  return instances.find((i) => i.htmlPath === abs) ?? null;
}

async function openBrowser(url: string): Promise<void> {
  const { default: open } = await import("open");
  await open(url);
}

// ─── open ────────────────────────────────────────────────────────────────────

async function cmdOpen(args: string[]): Promise<void> {
  const htmlArg = args[0];
  if (!htmlArg) {
    console.error("Usage: concurly open <file.html>");
    process.exit(1);
  }

  const htmlPath = path.resolve(htmlArg);
  if (!fs.existsSync(htmlPath)) {
    console.error(`File not found: ${htmlPath}`);
    process.exit(1);
  }

  // Re-use an existing live instance for the same file.
  const existing = readAllInstances().find(
    (i) => i.htmlPath === htmlPath && isAlive(i.pid)
  );
  if (existing) {
    const url = `http://localhost:${existing.port}`;
    console.log(`Instance already running for this file on port ${existing.port}`);
    console.log(`Opening: ${url}`);
    await openBrowser(url);
    return;
  }

  let port: number;
  try {
    port = await findFreePort(5391);
  } catch (err) {
    console.error((err as Error).message);
    console.error("Suggestion: run `concurly list` to see active sessions.");
    process.exit(1);
  }

  const clientSrc = path.join(__dirname, "client.js");
  let clientScript: string;
  try {
    clientScript = fs.readFileSync(clientSrc, "utf-8");
  } catch (err) {
    console.error(`Could not read client script: ${(err as Error).message}`);
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { version } = require(path.join(__dirname, "../package.json")) as { version: string };
  const portedScript = clientScript
    .replace('"__PORT__"', String(port))
    .replace('"__FILE_PATH__"', JSON.stringify(htmlPath))
    .replace("__VERSION__", version);

  // Per-instance temp file so parallel sessions don't overwrite each other.
  const tmpClientPath = path.join(os.tmpdir(), `concurly-client-${port}.js`);
  fs.writeFileSync(tmpClientPath, portedScript, "utf-8");

  const app = createServer(htmlPath, tmpClientPath);
  const storePath = getStorePath(htmlPath);

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  // Clean up state file (but never comments JSON) on graceful shutdown.
  const cleanup = () => {
    removeInstanceState(port);
    try { fs.unlinkSync(tmpClientPath); } catch { /* already gone */ }
  };

  // Don't wait for httpServer.close(callback) — it only fires after all
  // connections drain. An open browser WebSocket blocks it indefinitely.
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("SIGINT",  () => { cleanup(); process.exit(0); });

  // HTTP shutdown endpoint so cmdComplete can exit cleanly on Windows.
  // On Windows, process.kill(pid, "SIGTERM") uses TerminateProcess which bypasses
  // the SIGTERM handler, forcing exit code 1. The fetch approach lets the server
  // control its own exit code.
  app.post("/shutdown", (_req, res) => {
    res.json({ ok: true });
    setImmediate(() => { cleanup(); process.exit(0); });
  });

  httpServer.listen(port, "127.0.0.1", () => {
    writeInstanceState({ htmlPath, storePath, port, pid: process.pid, startedAt: new Date().toISOString() });
    const url = `http://localhost:${port}`;
    console.log(`concurly running on ${url}`);
    console.log(`File:     ${htmlPath}`);
    console.log(`Comments: ${storePath}`);
    console.log(`PID:      ${process.pid}`);
    createWatcher([htmlPath], storePath, wss);
    openBrowser(url).catch((err) => {
      console.error(`Could not open browser: ${(err as Error).message}`);
      console.log(`Open manually: ${url}`);
    });
  });
}

// ─── list ────────────────────────────────────────────────────────────────────

function cmdList(): void {
  const all = readAllInstances();

  const alive: State[] = [];
  for (const inst of all) {
    if (isAlive(inst.pid)) {
      alive.push(inst);
    } else {
      removeInstanceState(inst.port);
    }
  }

  if (alive.length === 0) {
    console.log("No concurly instances found.");
    return;
  }

  console.log("\nConcurly instances:\n");
  for (const inst of alive) {
    console.log(`  Port ${inst.port}  PID ${inst.pid}  [running]`);
    console.log(`  File:     ${inst.htmlPath}`);
    console.log(`  URL:      http://localhost:${inst.port}`);
    console.log(`  Started:  ${inst.startedAt}`);
    console.log();
  }
}

// ─── complete ────────────────────────────────────────────────────────────────

async function cmdComplete(args: string[]): Promise<void> {
  const target = args[0];
  const all = readAllInstances();
  let inst: State | null;

  if (!target) {
    // Auto-detect: no arg given — find the single alive instance.
    const alive = all.filter((i) => isAlive(i.pid));
    if (alive.length === 0) {
      for (const i of all) removeInstanceState(i.port); // clean up any stale files
      console.error("No active concurly session found. Run: concurly open <file.html>");
      process.exit(1);
    }
    if (alive.length === 1) {
      inst = alive[0];
    } else {
      console.error("Multiple sessions running. Specify a port or file path:");
      alive.forEach((i) => console.error(`  concurly complete ${i.port}  (${path.basename(i.htmlPath)})`));
      process.exit(1);
    }
  } else {
    inst = resolveInstance(target, all);
    if (!inst) {
      console.error(`No instance found for: ${target}`);
      console.error("Run `concurly list` to see active sessions.");
      process.exit(1);
    }
  }

  if (isAlive(inst.pid)) {
    try {
      // Use HTTP so the server calls process.exit(0) itself — on Windows,
      // process.kill uses TerminateProcess which exits with code 1 and skips handlers.
      await fetch(`http://127.0.0.1:${inst.port}/shutdown`, {
        method: "POST",
        signal: AbortSignal.timeout(3000),
      });
      console.log(`Stopped instance on port ${inst.port} (PID ${inst.pid})`);
    } catch {
      // Server already gone or unresponsive.
      console.log(`Instance on port ${inst.port} has already stopped.`);
    }
  } else {
    console.log(`Instance on port ${inst.port} was already stopped.`);
  }

  removeInstanceState(inst.port);
  console.log(`Comments preserved at: ${inst.storePath}`);
}

// ─── review / agent list ─────────────────────────────────────────────────────

function pickInstance(target: string | undefined): State {
  const alive = readAllInstances().filter((i) => isAlive(i.pid));

  if (alive.length === 0) {
    console.error("No active concurly session. Run: concurly open <file.html>");
    process.exit(1);
  }

  if (alive.length === 1 && !target) return alive[0];

  if (!target) {
    console.error("Multiple sessions running. Specify a port or file path:");
    alive.forEach((i) => console.error(`  concurly review ${i.port}  (${path.basename(i.htmlPath)})`));
    process.exit(1);
  }

  const inst = resolveInstance(target, alive);
  if (!inst) {
    console.error(`No active instance found for: ${target}`);
    process.exit(1);
  }
  return inst;
}

function cmdReview(args: string[]): void {
  const inst = pickInstance(args[0]);
  const comments = readComments(inst.storePath);
  const open = comments
    .filter((c) => c.status === "open")
    .map(({ id, selector, excerpt, body, createdAt }) => ({
      id, selector, excerpt, body, createdAt,
    }));

  process.stdout.write(
    JSON.stringify({ htmlFile: inst.htmlPath, port: inst.port, openComments: open }, null, 2) + "\n"
  );
}

// ─── agent resolve ───────────────────────────────────────────────────────────

function cmdAgentResolve(args: string[]): void {
  const [id, target] = args;
  if (!id) {
    console.error("Usage: concurly agent resolve <id> [port|path]");
    process.exit(1);
  }

  const inst = pickInstance(target);
  const ok = resolveComment(inst.storePath, id);
  if (!ok) {
    console.error(`Comment not found: ${id}`);
    process.exit(1);
  }

  console.log(`Resolved comment ${id}`);
}

// ─── help ────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`concurly — Review software architecture concurrently with an expert AI peer.

Commands:
  concurly open <file.html>              Open a design file in the browser (one instance per file)
  concurly list                          List all running instances with port, PID, and file
  concurly review [port|path]            Print open comments as JSON (port/path required if multiple sessions)
  concurly complete [port|path]          Stop a review session; auto-selects if only one is running
  concurly agent resolve <id> [port|path]  Mark a comment as resolved

Options:
  --help, -h                             Show this help message
`);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return;
  }

  const [cmd, ...rest] = argv;

  // `concurly <file.html>` shorthand defaults to open.
  if (cmd.endsWith(".html") || cmd.endsWith(".htm")) {
    await cmdOpen([cmd, ...rest]);
    return;
  }

  if (cmd === "open") { await cmdOpen(rest); return; }
  if (cmd === "list") { cmdList(); return; }
  if (cmd === "review") { cmdReview(rest); return; }
  if (cmd === "complete") { await cmdComplete(rest); return; }

  if (cmd === "agent") {
    const [subCmd, ...subRest] = rest;
    if (subCmd === "list") { cmdReview(subRest); return; }
    if (subCmd === "resolve") { cmdAgentResolve(subRest); return; }
    console.error(`Unknown agent subcommand: ${subCmd}`);
    console.error("Valid subcommands: list, resolve");
    process.exit(1);
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
