import os from "os";
import path from "path";

/** Root folder for everything concurly stores per user: `CONCURLY_HOME`, else `~/.concurly`. */
export function concurlyHome(): string {
  return process.env.CONCURLY_HOME ?? path.join(os.homedir(), ".concurly");
}
