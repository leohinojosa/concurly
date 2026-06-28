import chokidar from "chokidar";
import { WebSocketServer, WebSocket } from "ws";

export function createWatcher(
  htmlPaths: string[],
  commentsPath: string,
  wss: WebSocketServer
): void {
  const watcher = chokidar.watch([...htmlPaths, commentsPath], {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  watcher.on("change", (changedPath) => {
    const isComments = changedPath === commentsPath;
    const message = isComments
      ? { type: "comments-updated" }
      : { type: "reload", file: changedPath };

    console.log(
      isComments
        ? "[docreview] Comments file updated — refreshing sidebar"
        : `[docreview] File changed: ${changedPath} — reloading`
    );

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  });

  watcher.on("error", (err) => {
    console.error(`[docreview] Watcher error: ${(err as Error).message}`);
  });
}
