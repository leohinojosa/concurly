import express from "express";
import cors from "cors";
import fs from "fs";
import net from "net";
import path from "path";
import {
  readComments,
  writeComment,
  resolveComment,
  updateComment,
  deleteComment,
  getStorePath,
} from "./store";
import type { Comment } from "./store";

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

  app.patch("/comments/:id", (req, res) => {
    const { body } = req.body as { body?: string };
    if (!body || !body.trim()) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    const ok = updateComment(storePath, req.params.id, body.trim());
    if (!ok) {
      res.status(404).json({ error: "Comment not found or already resolved" });
      return;
    }
    res.json({ success: true });
  });

  app.patch("/comments/:id/resolve", (req, res) => {
    const ok = resolveComment(storePath, req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    res.json({ success: true });
  });

  app.delete("/comments/:id", (req, res) => {
    const ok = deleteComment(storePath, req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Comment not found or already resolved" });
      return;
    }
    res.json({ success: true });
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
