import fs from "node:fs/promises";
import path from "node:path";
import Fuse from "fuse.js";
import { claudeProjectsRoot } from "./claude-paths";
import { listProjects, listSessions, loadSession } from "./session-loader";
import { pMap } from "./cache";
import type { SearchHit, SessionEvent } from "./types";
import { extractText, stringifyToolInput, truncate } from "./utils";

interface IndexedItem {
  projectId: string;
  sessionId: string;
  sessionTitle: string;
  eventUuid?: string;
  text: string;
  textLower: string; // pre-lowercased for fast substring search
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
}

// In-memory index, persists for the lifetime of the server process.
// Per-session entries are reused across rebuilds when the file hasn't changed,
// so an "indexing" pass after edits only re-parses what changed.
const sessionIndex = new Map<string, PerSessionIndex>();
let allItems: IndexedItem[] = [];
// Fuse only against session titles — a small set (one per session),
// fast to query, and the only place fuzzy actually helps. Body fuzzy
// against 100k items takes 25s+ per query, so we skip it.
let titleFuse: Fuse<IndexedItem> | null = null;
let lastBuiltSig: string | null = null;
let building: Promise<void> | null = null;

const READ_CONCURRENCY = 6;

function extractItemsForEvents(
  events: SessionEvent[],
  projectId: string,
  sessionId: string,
  sessionTitle: string,
): IndexedItem[] {
  const items: IndexedItem[] = [];
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
    if (ev.type !== "user" && ev.type !== "assistant") continue;
    const msg = (ev as { message?: { content?: unknown } }).message;
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
        };
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
          push(b.text, "text", ev.uuid);
        } else if (b.type === "thinking" && typeof b.thinking === "string") {
          push(b.thinking, "thinking", ev.uuid);
        } else if (b.type === "tool_use") {
          push(stringifyToolInput(b.input), "tool_input", ev.uuid);
        } else if (b.type === "tool_result") {
          push(extractText([block]), "tool_result", ev.uuid);
        }
      }
    } else if (typeof content === "string" && content.trim()) {
      push(content, "text", ev.uuid);
    }
  }
  return items;
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

/** Trigger an async index build without awaiting. Used to pre-warm. */
export function warmSearchIndex(): void {
  rebuildIfNeeded().catch(() => {});
}

async function rebuildIfNeeded(): Promise<void> {
  const sig = await quickSignature();
  if (lastBuiltSig === sig && titleFuse) return;
  if (building) return building;
  building = (async () => {
    const projects = await listProjects();
    const targets: Array<{
      projectId: string;
      sessionId: string;
      title: string;
      filePath: string;
    }> = [];
    for (const project of projects) {
      const sessions = await listSessions(project.id);
      for (const session of sessions) {
        targets.push({
          projectId: project.id,
          sessionId: session.id,
          title: session.title,
          filePath: session.filePath,
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
        // refresh title metadata only — items are content-addressed by file sig
        cached.sessionTitle = t.title;
        for (const it of cached.items) it.sessionTitle = t.title;
        return;
      }

      let events: SessionEvent[];
      try {
        events = await loadSession(t.projectId, t.sessionId);
      } catch {
        return;
      }
      const entry: PerSessionIndex = {
        filePath: t.filePath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        projectId: t.projectId,
        sessionId: t.sessionId,
        sessionTitle: t.title,
        items: extractItemsForEvents(events, t.projectId, t.sessionId, t.title),
      };
      sessionIndex.set(t.filePath, entry);
    });

    // Drop entries for files no longer present.
    for (const key of Array.from(sessionIndex.keys())) {
      if (!validKeys.has(key)) sessionIndex.delete(key);
    }

    // Flatten + add session-title pseudo-rows.
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
    lastBuiltSig = sig;
  })();
  try {
    await building;
  } finally {
    building = null;
  }
}

function makeExcerpt(text: string, q: string): string {
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
  const q = query.trim();
  if (!q) return [];
  await rebuildIfNeeded();

  const ql = q.toLowerCase();

  // Phase 1: substring scan — O(N) but pure JS string scan is extremely fast
  // (a few ms even for 100k+ items). Most user queries are exact substrings.
  const substring: SearchHit[] = [];
  for (const item of allItems) {
    if (item.textLower.includes(ql)) {
      substring.push({
        projectId: item.projectId,
        sessionId: item.sessionId,
        eventUuid: item.eventUuid,
        excerpt: makeExcerpt(item.text, q),
        matchType: item.matchType,
        score: 0,
      });
      if (substring.length >= limit) break;
    }
  }
  if (!titleFuse) return substring;

  // Phase 2: fuzzy match against session titles only (small set, fast).
  // This handles partial / typo'd session names without scanning every message.
  const seen = new Set(
    substring.map((h) => `${h.sessionId}:${h.eventUuid || ""}:${h.matchType}`),
  );
  const fuzzy = titleFuse.search(q, { limit });
  const out = [...substring];
  for (const r of fuzzy) {
    const item = r.item;
    const k = `${item.sessionId}:${item.eventUuid || ""}:${item.matchType}`;
    if (seen.has(k)) continue;
    out.push({
      projectId: item.projectId,
      sessionId: item.sessionId,
      eventUuid: item.eventUuid,
      excerpt: makeExcerpt(item.text, q),
      matchType: item.matchType,
      score: r.score ?? 0,
    });
    if (out.length >= limit) break;
  }
  return out;
}
