import fs from "node:fs/promises";
import crypto from "node:crypto";
import type { ProjectMeta, SessionEvent, SessionMeta } from "./types";
import { readJsonl } from "./jsonl";
import { pMap } from "./cache";
import { findRolloutFiles, sessionIdFromRolloutPath } from "./codex-paths";
import { parseCodexRollout } from "./codex-parser";

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;
const READ_CONCURRENCY = 6;

/** Stable short id for a cwd → used as the Codex project rawId. */
export function codexProjectId(cwd: string): string {
  return crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 16);
}

interface RolloutInfo {
  filePath: string;
  sessionId: string;
  cwd: string;
  title: string;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  messageCount: number;
  toolUseCount: number;
  size: number;
  mtimeMs: number;
}

// readJsonl is typed as returning SessionEvent[] but the Codex JSONL lines
// have the Codex envelope shape — cast via unknown.
type Envelope = {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
};

async function summarizeRollout(filePath: string): Promise<RolloutInfo | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  // readJsonl returns Promise<SessionEvent[]>; Codex files carry Envelope
  // objects — cast through unknown[].
  const lines = (await readJsonl(filePath)) as unknown as Envelope[];
  let cwd = "";
  let title = "(codex session)";
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let messageCount = 0;
  let toolUseCount = 0;
  for (const ln of lines) {
    const p = ln.payload;
    if (ln.timestamp) {
      firstTimestamp = firstTimestamp ?? ln.timestamp;
      lastTimestamp = ln.timestamp;
    }
    if (!p) continue;
    if (ln.type === "session_meta" && typeof p["cwd"] === "string") {
      cwd = p["cwd"] as string;
    }
    if (p["type"] === "message") {
      messageCount++;
      if (
        title === "(codex session)" &&
        p["role"] === "user" &&
        Array.isArray(p["content"])
      ) {
        const t = (p["content"] as Array<{ text?: string }>)
          .map((x) => x?.text ?? "")
          .join("")
          .trim();
        if (t) title = t.slice(0, 100);
      }
    }
    if (p["type"] === "function_call") toolUseCount++;
  }
  return {
    filePath,
    sessionId: sessionIdFromRolloutPath(filePath),
    cwd: cwd || "(unknown cwd)",
    title,
    firstTimestamp,
    lastTimestamp,
    messageCount,
    toolUseCount,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

async function allRollouts(): Promise<RolloutInfo[]> {
  const files = await findRolloutFiles();
  // pMap callback signature: (item: T, i: number) => Promise<R>
  const infos = await pMap(files, READ_CONCURRENCY, (f, _i) => summarizeRollout(f));
  return infos.filter((x): x is RolloutInfo => !!x);
}

export async function listCodexProjects(): Promise<ProjectMeta[]> {
  const rollouts = await allRollouts();
  const byCwd = new Map<string, RolloutInfo[]>();
  for (const r of rollouts) {
    const arr = byCwd.get(r.cwd) ?? [];
    arr.push(r);
    byCwd.set(r.cwd, arr);
  }
  const projects: ProjectMeta[] = [];
  for (const [cwd, rs] of byCwd) {
    const last = Math.max(...rs.map((r) => r.mtimeMs));
    projects.push({
      id: codexProjectId(cwd),
      decodedPath: cwd,
      sessionCount: rs.length,
      lastModified: new Date(last).toISOString(),
      source: "codex",
    });
  }
  return projects;
}

export async function listCodexSessions(rawProjectId: string): Promise<SessionMeta[]> {
  const rollouts = await allRollouts();
  const now = Date.now();
  const out: SessionMeta[] = [];
  for (const r of rollouts) {
    if (codexProjectId(r.cwd) !== rawProjectId) continue;
    out.push({
      id: r.sessionId,
      projectId: rawProjectId,
      filePath: r.filePath,
      title: r.title,
      firstTimestamp: r.firstTimestamp,
      lastTimestamp: r.lastTimestamp,
      messageCount: r.messageCount,
      toolUseCount: r.toolUseCount,
      hasSubagents: false,
      cwd: r.cwd,
      fileSize: r.size,
      isActive: now - r.mtimeMs < ACTIVE_THRESHOLD_MS,
      source: "codex",
    });
  }
  out.sort((a, b) => {
    const at = a.lastTimestamp ? Date.parse(a.lastTimestamp) : 0;
    const bt = b.lastTimestamp ? Date.parse(b.lastTimestamp) : 0;
    return bt - at;
  });
  return out;
}

export async function loadCodexSession(
  _rawProjectId: string,
  sessionId: string,
): Promise<SessionEvent[]> {
  const files = await findRolloutFiles();
  const file = files.find((f) => sessionIdFromRolloutPath(f) === sessionId);
  if (!file) return [];
  // readJsonl returns SessionEvent[]; Codex files carry Envelope objects —
  // cast so parseCodexRollout sees the correct shape.
  const lines = (await readJsonl(file)) as unknown as Parameters<typeof parseCodexRollout>[0];
  return parseCodexRollout(lines, sessionId);
}
