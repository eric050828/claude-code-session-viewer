import fs from "node:fs/promises";
import path from "node:path";
import Fuse from "fuse.js";
import { claudeProjectsRoot } from "./claude-paths";
import { listProjects, listSessions, loadSession } from "./session-loader";
import { pMap } from "./cache";
import type { DistinctValues, SearchHit, SessionEvent } from "./types";
import { extractText, stringifyToolInput, truncate } from "./utils";
import { type HasFlag, type MatchType, parseQuery, type Token } from "./query-parser";

interface IndexedItem {
  projectId: string;
  sessionId: string;
  sessionTitle: string;
  eventUuid?: string;
  text: string;
  textLower: string;
  matchType: SearchHit["matchType"];
}

interface PerSessionIndex {
  filePath: string;
  mtimeMs: number;
  size: number;
  projectId: string;
  sessionId: string;
  sessionTitle: string;
  items: IndexedItem[];
  // Per-session metadata used for token filtering.
  decodedPath: string;
  gitBranch?: string;
  toolsUsed: Set<string>;
  modelsUsed: Set<string>;
  hasSubagents: boolean;
  hasThinking: boolean;
  hasErrors: boolean;
  /** Last activity timestamp (ms). Falls back to mtime when no events. */
  lastTimestamp: number;
}

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

const sessionIndex = new Map<string, PerSessionIndex>();
let allItems: IndexedItem[] = [];
let titleFuse: Fuse<IndexedItem> | null = null;
let lastBuiltSig: string | null = null;
let building: Promise<void> | null = null;
let distinctCache: DistinctValues | null = null;

const READ_CONCURRENCY = 6;

function extractIndexForEvents(
  events: SessionEvent[],
  projectId: string,
  sessionId: string,
  sessionTitle: string,
  decodedPath: string,
  fallbackTimestamp: number,
): PerSessionIndex {
  const items: IndexedItem[] = [];
  const toolsUsed = new Set<string>();
  const modelsUsed = new Set<string>();
  let hasSubagents = false;
  let hasThinking = false;
  let hasErrors = false;
  let gitBranch: string | undefined;
  let lastTimestamp = fallbackTimestamp;

  const push = (
    text: string,
    matchType: SearchHit["matchType"],
    eventUuid?: string,
  ) => {
    if (!text) return;
    items.push({
      projectId,
      sessionId,
      sessionTitle,
      eventUuid,
      text,
      textLower: text.toLowerCase(),
      matchType,
    });
  };

  for (const ev of events) {
    if (ev.timestamp) {
      const t = Date.parse(ev.timestamp);
      if (!Number.isNaN(t) && t > lastTimestamp) lastTimestamp = t;
    }
    if (ev.gitBranch && !gitBranch) gitBranch = ev.gitBranch;

    if (ev.type !== "user" && ev.type !== "assistant") continue;
    const msg = (ev as { message?: { content?: unknown; model?: string } })
      .message;
    if (msg?.model) modelsUsed.add(msg.model);

    const content = msg?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as {
          type?: string;
          text?: string;
          thinking?: string;
          input?: unknown;
          content?: unknown;
          name?: string;
          is_error?: boolean;
        };
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          push(b.text, "text", ev.uuid);
        } else if (b.type === "thinking" && typeof b.thinking === "string") {
          hasThinking = true;
          push(b.thinking, "thinking", ev.uuid);
        } else if (b.type === "tool_use") {
          const name = b.name || "?";
          toolsUsed.add(name);
          if (name === "Task" || name === "Agent") hasSubagents = true;
          push(stringifyToolInput(b.input), "tool_input", ev.uuid);
        } else if (b.type === "tool_result") {
          if (b.is_error) hasErrors = true;
          push(extractText([block]), "tool_result", ev.uuid);
        }
      }
    } else if (typeof content === "string" && content.trim()) {
      push(content, "text", ev.uuid);
    }
  }

  return {
    filePath: "", // set by caller
    mtimeMs: 0,
    size: 0,
    projectId,
    sessionId,
    sessionTitle,
    items,
    decodedPath,
    gitBranch,
    toolsUsed,
    modelsUsed,
    hasSubagents,
    hasThinking,
    hasErrors,
    lastTimestamp,
  };
}

async function quickSignature(): Promise<string> {
  const root = claudeProjectsRoot();
  const projects = await fs.readdir(root).catch(() => []);
  const parts: string[] = [];
  for (const p of projects) {
    const dir = path.join(root, p);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        const s = await fs.stat(path.join(dir, f));
        parts.push(`${path.join(dir, f)}:${s.mtimeMs}:${s.size}`);
      } catch {}
    }
  }
  return parts.join("|");
}

export function warmSearchIndex(): void {
  rebuildIfNeeded().catch(() => {});
}

async function rebuildIfNeeded(): Promise<void> {
  const sig = await quickSignature();
  if (lastBuiltSig === sig && titleFuse) return;
  if (building) return building;
  building = (async () => {
    const projects = await listProjects();
    const projectPathById = new Map(projects.map((p) => [p.id, p.decodedPath]));
    const targets: Array<{
      projectId: string;
      sessionId: string;
      title: string;
      filePath: string;
      decodedPath: string;
    }> = [];
    for (const project of projects) {
      const sessions = await listSessions(project.id);
      for (const session of sessions) {
        targets.push({
          projectId: project.id,
          sessionId: session.id,
          title: session.title,
          filePath: session.filePath,
          decodedPath: projectPathById.get(project.id) || "",
        });
      }
    }

    const validKeys = new Set<string>();

    await pMap(targets, READ_CONCURRENCY, async (t) => {
      let stat;
      try {
        stat = await fs.stat(t.filePath);
      } catch {
        return;
      }
      validKeys.add(t.filePath);

      const cached = sessionIndex.get(t.filePath);
      if (
        cached &&
        cached.mtimeMs === stat.mtimeMs &&
        cached.size === stat.size
      ) {
        cached.sessionTitle = t.title;
        cached.decodedPath = t.decodedPath;
        for (const it of cached.items) it.sessionTitle = t.title;
        return;
      }

      let events: SessionEvent[];
      try {
        events = await loadSession(t.projectId, t.sessionId);
      } catch {
        return;
      }
      const built = extractIndexForEvents(
        events,
        t.projectId,
        t.sessionId,
        t.title,
        t.decodedPath,
        stat.mtimeMs,
      );
      built.filePath = t.filePath;
      built.mtimeMs = stat.mtimeMs;
      built.size = stat.size;
      sessionIndex.set(t.filePath, built);
    });

    for (const key of Array.from(sessionIndex.keys())) {
      if (!validKeys.has(key)) sessionIndex.delete(key);
    }

    const flat: IndexedItem[] = [];
    const titles: IndexedItem[] = [];
    for (const entry of sessionIndex.values()) {
      const titleItem: IndexedItem = {
        projectId: entry.projectId,
        sessionId: entry.sessionId,
        sessionTitle: entry.sessionTitle,
        text: entry.sessionTitle,
        textLower: entry.sessionTitle.toLowerCase(),
        matchType: "title",
      };
      flat.push(titleItem);
      titles.push(titleItem);
      for (const it of entry.items) flat.push(it);
    }

    allItems = flat;
    titleFuse = new Fuse(titles, {
      keys: ["text"],
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: true,
      minMatchCharLength: 2,
    });
    distinctCache = null; // invalidate
    lastBuiltSig = sig;
  })();
  try {
    await building;
  } finally {
    building = null;
  }
}

/**
 * Apply token filters to the session index. Returns the set of session
 * filePaths that satisfy every filter (AND semantics). `unknown`-tagged
 * tokens contribute their literal `key:value` to the free-text remainder
 * — handled by the caller, not here.
 */
function applyFilters(filters: Token[]): Set<string> {
  const all = new Set<string>(sessionIndex.keys());
  if (!filters.length) return all;

  const keep = (entry: PerSessionIndex, token: Token): boolean => {
    if (token.unknown || token.error) return true; // ignore; treated as free text upstream
    const v = token.value.toLowerCase();
    switch (token.key) {
      case "id":
        return entry.sessionId.toLowerCase().startsWith(v);
      case "project":
        return entry.decodedPath.toLowerCase().includes(v);
      case "branch":
        return (entry.gitBranch || "").toLowerCase().includes(v);
      case "tool":
        // tool names are case-sensitive in jsonl (Bash, Edit, etc.)
        return entry.toolsUsed.has(token.value);
      case "model":
        for (const m of entry.modelsUsed) if (m.toLowerCase().includes(v)) return true;
        return false;
      case "has":
        if (token.value === "subagents") return entry.hasSubagents;
        if (token.value === "thinking") return entry.hasThinking;
        if (token.value === "errors") return entry.hasErrors;
        if (token.value === "active")
          return Date.now() - entry.lastTimestamp < ACTIVE_THRESHOLD_MS;
        return false;
      case "after":
        return token.resolved ? entry.lastTimestamp >= token.resolved.getTime() : true;
      case "before":
        return token.resolved ? entry.lastTimestamp < token.resolved.getTime() : true;
      case "type":
        // type doesn't filter sessions — it filters items downstream
        return true;
      default:
        return true;
    }
  };

  const out = new Set<string>();
  for (const filePath of all) {
    const entry = sessionIndex.get(filePath)!;
    let ok = true;
    for (const f of filters) {
      const match = keep(entry, f);
      if (f.negate ? match : !match) {
        ok = false;
        break;
      }
    }
    if (ok) out.add(filePath);
  }
  return out;
}

function makeExcerpt(text: string, q: string): string {
  if (!q) return truncate(text, 160);
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const idx = lower.indexOf(ql);
  if (idx >= 0) {
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + ql.length + 80);
    return (
      (start > 0 ? "…" : "") +
      text.slice(start, end) +
      (end < text.length ? "…" : "")
    );
  }
  return truncate(text, 160);
}

export async function search(query: string, limit = 50): Promise<SearchHit[]> {
  await rebuildIfNeeded();
  const parsed = parseQuery(query);

  // Hoist `unknown` tokens back into free text — user typed `foo:bar` and
  // we don't know that key, so just substring-match the literal string.
  const literalUnknowns = parsed.filters
    .filter((t) => t.unknown)
    .map((t) => `${t.negate ? "-" : ""}${t.key}:${t.value}`);
  const freeText = [parsed.freeText, ...literalUnknowns].filter(Boolean).join(" ");
  const realFilters = parsed.filters.filter((t) => !t.unknown);
  const typeFilter = realFilters.find((t) => t.key === "type" && !t.negate)?.value;
  const negatedTypes = new Set(
    realFilters.filter((t) => t.key === "type" && t.negate).map((t) => t.value),
  );

  const sessionCandidates = applyFilters(realFilters);
  if (sessionCandidates.size === 0) return [];

  // If there's no free text needle, return one hit per candidate session.
  if (!freeText) {
    const out: SearchHit[] = [];
    for (const filePath of sessionCandidates) {
      const entry = sessionIndex.get(filePath)!;
      out.push({
        projectId: entry.projectId,
        sessionId: entry.sessionId,
        eventUuid: undefined,
        excerpt: entry.sessionTitle,
        matchType: "title",
        score: 0,
        via: "filter",
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // Free-text path: same substring+fuse as before, but restricted to
  // sessions that survived the token filters.
  const candidateSessionIds = new Set<string>();
  for (const filePath of sessionCandidates) {
    const entry = sessionIndex.get(filePath)!;
    candidateSessionIds.add(entry.sessionId);
  }
  const ql = freeText.toLowerCase();

  const substring: SearchHit[] = [];
  for (const item of allItems) {
    if (!candidateSessionIds.has(item.sessionId)) continue;
    if (typeFilter && item.matchType !== typeFilter) continue;
    if (negatedTypes.has(item.matchType)) continue;
    if (item.textLower.includes(ql)) {
      substring.push({
        projectId: item.projectId,
        sessionId: item.sessionId,
        eventUuid: item.eventUuid,
        excerpt: makeExcerpt(item.text, freeText),
        matchType: item.matchType,
        score: 0,
        via: item.matchType,
      });
      if (substring.length >= limit) break;
    }
  }
  if (!titleFuse) return substring;

  const seen = new Set(
    substring.map((h) => `${h.sessionId}:${h.eventUuid || ""}:${h.matchType}`),
  );
  const fuzzy = titleFuse.search(freeText, { limit });
  const out = [...substring];
  for (const r of fuzzy) {
    const item = r.item;
    if (!candidateSessionIds.has(item.sessionId)) continue;
    const k = `${item.sessionId}:${item.eventUuid || ""}:${item.matchType}`;
    if (seen.has(k)) continue;
    out.push({
      projectId: item.projectId,
      sessionId: item.sessionId,
      eventUuid: item.eventUuid,
      excerpt: makeExcerpt(item.text, freeText),
      matchType: item.matchType,
      score: r.score ?? 0,
      via: "title",
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Distinct values for autocomplete. Computed once per index rebuild.
 */
export async function getDistinctValues(): Promise<DistinctValues> {
  await rebuildIfNeeded();
  if (distinctCache) return distinctCache;
  const toolCounts = new Map<string, number>();
  const branches = new Set<string>();
  const models = new Set<string>();
  for (const entry of sessionIndex.values()) {
    for (const t of entry.toolsUsed)
      toolCounts.set(t, (toolCounts.get(t) || 0) + 1);
    if (entry.gitBranch) branches.add(entry.gitBranch);
    for (const m of entry.modelsUsed) models.add(m);
  }
  distinctCache = {
    tools: Array.from(toolCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    branches: Array.from(branches).sort(),
    models: Array.from(models).sort(),
  };
  return distinctCache;
}

// Re-export for ergonomic imports
export type { Token, MatchType, HasFlag };
