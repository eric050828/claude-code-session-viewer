import fs from "node:fs/promises";
import path from "node:path";
import { claudeProjectsRoot, decodeProjectId } from "./claude-paths";
import { readJsonl } from "./jsonl";
import type {
  ProjectMeta,
  SessionEvent,
  SessionMeta,
  SubagentMeta,
} from "./types";
import {
  getCached,
  loadCache,
  pMap,
  pruneCache,
  setCached,
} from "./cache";

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;
const READ_CONCURRENCY = 6;
const SESSIONS_CACHE = "sessions-meta.json";

type CachedSummary = Omit<SessionMeta, "isActive">;

export async function listProjects(): Promise<ProjectMeta[]> {
  const root = claudeProjectsRoot();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }

  const result: ProjectMeta[] = await pMap(entries, READ_CONCURRENCY, async (name) => {
    const dir = path.join(root, name);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch {
      return null;
    }
    if (!stat.isDirectory()) return null;

    const files = await fs.readdir(dir).catch(() => []);
    let sessionCount = 0;
    let lastModified = stat.mtime;
    let mostRecentJsonl: string | null = null;
    let mostRecentMtime = 0;
    // Stat each .jsonl in parallel.
    const jsonlNames = files.filter((f) => f.endsWith(".jsonl"));
    const jsonlStats = await pMap(jsonlNames, READ_CONCURRENCY, async (f) => {
      try {
        return { f, s: await fs.stat(path.join(dir, f)) };
      } catch {
        return null;
      }
    });
    for (const r of jsonlStats) {
      if (!r) continue;
      sessionCount++;
      if (r.s.mtime > lastModified) lastModified = r.s.mtime;
      if (r.s.mtime.getTime() > mostRecentMtime) {
        mostRecentMtime = r.s.mtime.getTime();
        mostRecentJsonl = path.join(dir, r.f);
      }
    }

    // Encoding `/` and `_` both map to `-`, so we can't decode losslessly.
    // Read cwd from a real session event for the canonical path.
    let decodedPath = decodeProjectId(name);
    if (mostRecentJsonl) {
      const cwd = await firstCwdInJsonl(mostRecentJsonl);
      if (cwd) decodedPath = cwd;
    }

    return {
      id: name,
      decodedPath,
      sessionCount,
      lastModified: lastModified.toISOString(),
    } satisfies ProjectMeta;
  }).then((arr) => arr.filter((p): p is ProjectMeta => !!p));

  result.sort(
    (a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );
  return result;
}

async function firstCwdInJsonl(filePath: string): Promise<string | null> {
  // Read just enough of the file to find the first `cwd` field.
  try {
    const fh = await fs.open(filePath, "r");
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    await fh.close();
    const text = buf.subarray(0, bytesRead).toString("utf-8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (typeof obj.cwd === "string" && obj.cwd) return obj.cwd as string;
      } catch {
        // partial line at the end — skip
      }
    }
  } catch {}
  return null;
}

export async function listSessions(projectId: string): Promise<SessionMeta[]> {
  const root = claudeProjectsRoot();
  const dir = path.join(root, projectId);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const jsonlFiles: { name: string; filePath: string }[] = [];
  for (const name of files) {
    if (!name.endsWith(".jsonl")) continue;
    jsonlFiles.push({ name, filePath: path.join(dir, name) });
  }

  const now = Date.now();
  const validKeys = new Set<string>();
  // Stat all files in parallel (cheap), then summarize with bounded concurrency.
  const stats = await pMap(jsonlFiles, READ_CONCURRENCY, async (f) => {
    try {
      const s = await fs.stat(f.filePath);
      return { f, stat: s };
    } catch {
      return null;
    }
  });

  const out: SessionMeta[] = await pMap(
    stats.filter((s): s is NonNullable<typeof s> => !!s),
    READ_CONCURRENCY,
    async ({ f, stat }) => {
      const sig = { mtimeMs: stat.mtimeMs, size: stat.size };
      validKeys.add(f.filePath);

      let summary = getCached<CachedSummary>(SESSIONS_CACHE, f.filePath, sig);
      if (!summary) {
        const fresh = await summarizeSession(f.filePath, projectId);
        summary = { ...fresh, fileSize: stat.size };
        setCached<CachedSummary>(SESSIONS_CACHE, f.filePath, sig, summary);
      }
      return {
        ...summary,
        isActive: now - stat.mtime.getTime() < ACTIVE_THRESHOLD_MS,
      };
    },
  );

  // Drop entries for files that no longer exist in this project dir
  // (we only have keys for this dir, so prune happens incrementally per project).
  pruneCacheForDir(SESSIONS_CACHE, dir, validKeys);

  out.sort((a, b) => {
    const at = a.lastTimestamp ? new Date(a.lastTimestamp).getTime() : 0;
    const bt = b.lastTimestamp ? new Date(b.lastTimestamp).getTime() : 0;
    return bt - at;
  });
  return out;
}

function pruneCacheForDir(
  cacheName: string,
  dir: string,
  validKeysInDir: Set<string>,
) {
  // Keep all keys outside this dir + the valid ones inside it.
  const prefix = dir.endsWith("/") ? dir : dir + "/";
  const cache = loadCache(cacheName);
  const allValid = new Set<string>();
  for (const key of Object.keys(cache.entries)) {
    if (!key.startsWith(prefix) || validKeysInDir.has(key)) {
      allValid.add(key);
    }
  }
  pruneCache(cacheName, allValid);
}

async function summarizeSession(
  filePath: string,
  projectId: string,
): Promise<Omit<SessionMeta, "fileSize" | "isActive">> {
  const id = path.basename(filePath, ".jsonl");
  const events = await readJsonl(filePath);

  let title = "(empty session)";
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let messageCount = 0;
  let toolUseCount = 0;
  let gitBranch: string | undefined;
  let cwd: string | undefined;
  let aiTitle: string | undefined;
  let customTitle: string | undefined;
  let agentName: string | undefined;
  let firstUserText: string | undefined;

  for (const ev of events) {
    if (ev.timestamp) {
      if (!firstTimestamp) firstTimestamp = ev.timestamp;
      lastTimestamp = ev.timestamp;
    }
    if (ev.gitBranch && !gitBranch) gitBranch = ev.gitBranch;
    if (ev.cwd && !cwd) cwd = ev.cwd;

    if (ev.type === "user" || ev.type === "assistant") messageCount++;
    // Claude Code emits these with camelCase value fields (latest event wins).
    if (ev.type === "ai-title") {
      const v = (ev as { aiTitle?: string }).aiTitle;
      if (v) aiTitle = v;
    }
    if (ev.type === "custom-title") {
      const v = (ev as { customTitle?: string }).customTitle;
      if (v) customTitle = v;
    }
    if (ev.type === "agent-name") {
      const v = (ev as { agentName?: string }).agentName;
      if (v) agentName = v;
    }

    if (ev.type === "user" && !firstUserText) {
      const msg = (ev as { message?: { content?: unknown } }).message;
      const content = msg?.content;
      if (typeof content === "string") {
        firstUserText = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            typeof block === "object" &&
            (block as { type?: string }).type === "text"
          ) {
            firstUserText = (block as { text?: string }).text;
            break;
          }
        }
      }
    }

    if (ev.type === "assistant") {
      const msg = (ev as { message?: { content?: unknown } }).message;
      const content = msg?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            typeof block === "object" &&
            (block as { type?: string }).type === "tool_use"
          ) {
            toolUseCount++;
          }
        }
      }
    }
  }

  // Priority: user-set rename (custom-title or agent-name from /rename)
  // → AI-generated title → first user message → session id prefix.
  title =
    customTitle ||
    agentName ||
    aiTitle ||
    (firstUserText ? firstUserText.trim().slice(0, 80) : title);
  // strip prompt-injection style noise from title
  title = title.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (!title) title = id.slice(0, 8);

  const hasSubagents = await hasSubagentDir(filePath);

  return {
    id,
    projectId,
    filePath,
    title,
    firstTimestamp,
    lastTimestamp,
    messageCount,
    toolUseCount,
    hasSubagents,
    gitBranch,
    cwd,
  };
}

async function hasSubagentDir(sessionFilePath: string): Promise<boolean> {
  const dir = sessionFilePath.replace(/\.jsonl$/, "");
  try {
    const subDir = path.join(dir, "subagents");
    const stat = await fs.stat(subDir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function loadSession(
  projectId: string,
  sessionId: string,
): Promise<SessionEvent[]> {
  const root = claudeProjectsRoot();
  const filePath = path.join(root, projectId, `${sessionId}.jsonl`);
  return readJsonl(filePath);
}

export function sessionFilePath(projectId: string, sessionId: string): string {
  const root = claudeProjectsRoot();
  return path.join(root, projectId, `${sessionId}.jsonl`);
}

export async function listSubagents(
  projectId: string,
  sessionId: string,
): Promise<SubagentMeta[]> {
  const root = claudeProjectsRoot();
  const subDir = path.join(root, projectId, sessionId, "subagents");
  let files: string[];
  try {
    files = await fs.readdir(subDir);
  } catch {
    return [];
  }
  const out: SubagentMeta[] = [];
  for (const name of files) {
    if (!name.endsWith(".jsonl")) continue;
    const agentId = name.replace(/\.jsonl$/, "");
    const filePath = path.join(subDir, name);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    const metaPath = path.join(subDir, `${agentId}.meta.json`);
    let meta: Record<string, unknown> | undefined;
    try {
      const txt = await fs.readFile(metaPath, "utf-8");
      meta = JSON.parse(txt);
    } catch {}
    out.push({
      agentId,
      filePath,
      fileSize: stat.size,
      lastModified: stat.mtime.toISOString(),
      meta,
    });
  }
  return out;
}

export async function loadSubagent(
  projectId: string,
  sessionId: string,
  agentId: string,
): Promise<SessionEvent[]> {
  const root = claudeProjectsRoot();
  const filePath = path.join(
    root,
    projectId,
    sessionId,
    "subagents",
    `${agentId}.jsonl`,
  );
  return readJsonl(filePath);
}
