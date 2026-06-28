#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import { createServer, findFreePort } from "./server";
import { getStorePath, readComments, resolveComment } from "./store";

const STATE_FILE = path.join(os.tmpdir(), "docreview-state.json");

interface State {
  htmlPath: string;
  storePath: string;
  port: number;
  startedAt: string;
}

function writeState(state: State): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function readState(): State | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as State;
  } catch {
    return null;
  }
}

async function openBrowser(url: string): Promise<void> {
  const { default: open } = await import("open");
  await open(url);
}

async function cmdOpen(args: string[]): Promise<void> {
  const htmlArg = args[0];
  if (!htmlArg) {
    console.error("Usage: docreview open <file.html>");
    process.exit(1);
  }

  const htmlPath = path.resolve(htmlArg);
  if (!fs.existsSync(htmlPath)) {
    console.error(`File not found: ${htmlPath}`);
    process.exit(1);
  }

  let port: number;
  try {
    port = await findFreePort(5391);
  } catch (err) {
    console.error((err as Error).message);
    console.error("Suggestion: close other docreview sessions and try again.");
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

  const portedScript = clientScript
    .replace('"__PORT__"', String(port))
    .replace('"__FILE_PATH__"', JSON.stringify(htmlPath));
  const tmpClientPath = path.join(os.tmpdir(), "docreview-client.js");
  fs.writeFileSync(tmpClientPath, portedScript, "utf-8");

  const app = createServer(htmlPath, tmpClientPath);
  const storePath = getStorePath(htmlPath);

  app.listen(port, "127.0.0.1", () => {
    writeState({ htmlPath, storePath, port, startedAt: new Date().toISOString() });
    const url = `http://localhost:${port}`;
    console.log(`docreview running on ${url}`);
    console.log(`Comments stored at: ${storePath}`);
    openBrowser(url).catch((err) => {
      console.error(`Could not open browser: ${(err as Error).message}`);
      console.log(`Open manually: ${url}`);
    });
  });
}

function cmdAgentList(): void {
  const state = readState();
  if (!state) {
    console.error("No active docreview session. Run: docreview open <file.html>");
    process.exit(1);
  }

  const comments = readComments(state.storePath);
  const open = comments
    .filter((c) => c.status === "open")
    .map(({ id, selector, excerpt, body, createdAt }) => ({
      id,
      selector,
      excerpt,
      body,
      createdAt,
    }));

  const output = {
    htmlFile: state.htmlPath,
    openComments: open,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

function cmdAgentResolve(args: string[]): void {
  const id = args[0];
  if (!id) {
    console.error("Usage: docreview agent resolve <id>");
    process.exit(1);
  }

  const state = readState();
  if (!state) {
    console.error("No active docreview session. Run: docreview open <file.html>");
    process.exit(1);
  }

  const ok = resolveComment(state.storePath, id);
  if (!ok) {
    console.error(`Comment not found: ${id}`);
    process.exit(1);
  }

  console.log(`Resolved comment ${id}`);
}

function printHelp(): void {
  console.log(`docreview — Local HTML design review tool

Commands:
  docreview open <file.html>        Open a design file in the browser with comment overlay
  docreview agent list              List all open comments for the active session (JSON)
  docreview agent resolve <id>      Mark a comment as resolved

Options:
  --help, -h                        Show this help message
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return;
  }

  const [cmd, ...rest] = argv;

  if (cmd === "open") {
    await cmdOpen(rest);
    return;
  }

  if (cmd === "agent") {
    const [subCmd, ...subRest] = rest;
    if (subCmd === "list") {
      cmdAgentList();
      return;
    }
    if (subCmd === "resolve") {
      cmdAgentResolve(subRest);
      return;
    }
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
