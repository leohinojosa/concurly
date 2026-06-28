import chokidar from "chokidar";
import { WebSocketServer, WebSocket } from "ws";

export function createWatcher(htmlPaths: string[], wss: WebSocketServer): void {
  const watcher = chokidar.watch(htmlPaths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  watcher.on("change", (changedPath) => {
    console.log(`[docreview] File changed: ${changedPath} — reloading`);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "reload", file: changedPath }));
      }
    });
  });

  watcher.on("error", (err) => {
    console.error(`[docreview] Watcher error: ${(err as Error).message}`);
  });
}
