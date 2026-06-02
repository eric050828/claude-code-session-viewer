import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Root of Codex rollout logs. Override with CCSV_CODEX_DIR for tests. */
export function codexSessionsRoot(): string {
  return (
    process.env.CCSV_CODEX_DIR || path.join(os.homedir(), ".codex", "sessions")
  );
}

/** Recursively find every rollout-*.jsonl under the date-bucketed tree. */
export async function findRolloutFiles(): Promise<string[]> {
  const root = codexSessionsRoot();
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl"))
        out.push(full);
    }
  }
  await walk(root);
  return out;
}

/** Session uuid from a rollout filename: rollout-<ts>-<uuid>.jsonl */
export function sessionIdFromRolloutPath(filePath: string): string {
  const base = path.basename(filePath, ".jsonl"); // rollout-2026-...-<uuid>
  const m = base.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  return m ? m[1] : base;
}
