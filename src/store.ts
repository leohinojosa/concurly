import fs from "fs";
import path from "path";

export interface Comment {
  id: string;
  selector: string;
  excerpt: string;
  body: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
}

export function getStorePath(htmlPath: string): string {
  const dir = path.dirname(path.resolve(htmlPath));
  const base = path.basename(htmlPath, path.extname(htmlPath));
  return path.join(dir, `${base}.comments.json`);
}

export function readComments(storePath: string): Comment[] {
  if (!fs.existsSync(storePath)) return [];
  return JSON.parse(fs.readFileSync(storePath, "utf-8"));
}

export function writeComment(storePath: string, comment: Comment): void {
  const comments = readComments(storePath);
  comments.push(comment);
  fs.writeFileSync(storePath, JSON.stringify(comments, null, 2), "utf-8");
}

export function resolveComment(storePath: string, id: string): boolean {
  const comments = readComments(storePath);
  const target = comments.find((c) => c.id === id);
  if (!target) return false;
  target.status = "resolved";
  target.resolvedAt = new Date().toISOString();
  fs.writeFileSync(storePath, JSON.stringify(comments, null, 2), "utf-8");
  return true;
}
