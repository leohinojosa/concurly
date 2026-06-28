import express from "express";
import cors from "cors";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { readComments, writeComment, resolveComment, getStorePath } from "./store";
import type { Comment } from "./store";

// Shared SSE client registry — persists across requests for the lifetime of the server
let sseClients: express.Response[] = [];

interface DocreviewState {
  htmlPath: string;
  storePath: string;
  port: number;
  startedAt: string;
}

export function readStateFile(): DocreviewState | null {
  const statePath = path.join(os.tmpdir(), "docreview-state.json");
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf-8")) as DocreviewState;
  } catch {
    return null;
  }
}

function buildAgentPrompt(
  htmlPath: string,
  storePath: string,
  openComments: Comment[],
  htmlContent: string
): string {
  const commentsJson = JSON.stringify(
    openComments.map(({ id, selector, excerpt, body }) => ({ id, selector, excerpt, body })),
    null,
    2
  );
  return `You are reviewing a design document based on comments left by the user.

## Your task
Read each open comment below. For each comment:
1. Identify the HTML element using the CSS selector provided
2. Understand what the user is asking to change based on the comment body
3. Edit the HTML file on disk to address the comment
4. Run the CLI command to mark the comment resolved: docreview agent resolve <id>
5. Move on to the next comment

## Files
HTML file path: ${htmlPath}
Comments store path: ${storePath}

## Open comments
${commentsJson}

## Current HTML content
\`\`\`html
${htmlContent}
\`\`\`

## Rules
- Make only the changes requested in each comment body — do not refactor or reformat unrelated parts
- After editing the HTML file, always run: docreview agent resolve <id>
- If a selector no longer matches any element, skip that comment and note it
- After all comments are addressed, print a summary of what was changed

Begin now.`;
}

export function createServer(htmlPath: string, clientScriptPath: string) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const storePath = getStorePath(htmlPath);

  app.get("/", (_req, res) => {
    let html: string;
    try {
      html = fs.readFileSync(path.resolve(htmlPath), "utf-8");
    } catch (err) {
      res.status(500).send(`Failed to read HTML file: ${(err as Error).message}`);
      return;
    }

    const clientScript = fs.readFileSync(clientScriptPath, "utf-8");
    const scriptTag = `<script>\n${clientScript}\n</script>`;

    if (html.includes("</body>")) {
      html = html.replace("</body>", `${scriptTag}\n</body>`);
    } else {
      html += scriptTag;
    }

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  });

  app.get("/comments", (_req, res) => {
    res.json(readComments(storePath));
  });

  app.post("/comments", (req, res) => {
    const { selector, excerpt, body } = req.body as {
      selector?: string;
      excerpt?: string;
      body?: string;
    };

    if (!selector || !body) {
      res.status(400).json({ error: "selector and body are required" });
      return;
    }

    const comment: Comment = {
      id: crypto.randomUUID(),
      selector,
      excerpt: excerpt || "",
      body,
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };

    writeComment(storePath, comment);
    res.status(201).json(comment);
  });

  app.patch("/comments/:id/resolve", (req, res) => {
    const ok = resolveComment(storePath, req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    res.json({ success: true });
  });

  // Phase 2: spawn claude to address all open comments
  app.post("/nudge", (req, res) => {
    const openComments = readComments(storePath).filter((c) => c.status === "open");

    if (openComments.length === 0) {
      res.status(400).json({ error: "No open comments to review" });
      return;
    }

    let htmlContent: string;
    try {
      htmlContent = fs.readFileSync(path.resolve(htmlPath), "utf-8");
    } catch (err) {
      res.status(500).json({ error: `Failed to read HTML file: ${(err as Error).message}` });
      return;
    }

    const prompt = buildAgentPrompt(htmlPath, storePath, openComments, htmlContent);

    // Respond immediately so the browser can open the SSE stream
    res.json({ status: "started", commentCount: openComments.length });

    // shell: true — required on Windows since `claude` is a .cmd wrapper
    // windowsHide: true — suppress the console window flash
    // stdio pipe — required so we can write to stdin and read from stdout/stderr
    const child = spawn("claude", ["-p", "-"], {
      shell: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Feed prompt via stdin to avoid the Windows 32,767-char command-line limit.
    // If claude doesn't support reading from stdin via `-p -`, pass the prompt
    // as a positional arg instead: spawn("claude", ["-p", prompt], {...}).
    child.stdin.write(prompt);
    child.stdin.end();

    const broadcast = (text: string) => {
      const payload = `data: ${JSON.stringify({ text })}\n\n`;
      sseClients.forEach((client) => {
        try {
          client.write(payload);
        } catch {}
      });
    };

    child.stdout.on("data", (chunk: Buffer) => broadcast(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => broadcast(`[stderr] ${chunk.toString()}`));

    child.on("close", (code) => {
      broadcast(`\n[docreview] Agent finished (exit code ${code ?? "?"})`);
      const done = `data: ${JSON.stringify({ done: true })}\n\n`;
      sseClients.forEach((client) => {
        try {
          client.write(done);
        } catch {}
      });
    });

    child.on("error", (err) => {
      broadcast(
        `[docreview] Failed to start claude: ${err.message}\nIs claude installed and on your PATH?`
      );
    });
  });

  // Phase 2: SSE stream — browser connects here to receive claude output
  app.get("/nudge/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    sseClients.push(res);

    // Keep idle connections alive through proxy timeouts
    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {}
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      sseClients = sseClients.filter((c) => c !== res);
    });
  });

  return app;
}

export function findFreePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      if (startPort < 5401) {
        resolve(findFreePort(startPort + 1));
      } else {
        reject(new Error("No free port found in range 5391–5401"));
      }
    });
  });
}
