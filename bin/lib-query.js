// Standalone query helpers used by the CLI subcommands.
// Pure Node — no Next.js / TS runtime needed.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

function projectsRoot() {
  return (
    process.env.CCSV_PROJECTS_DIR ||
    path.join(os.homedir(), ".claude", "projects")
  );
}

function decodeProjectId(id) {
  // Encoding `/` and `_` both map to `-`, so this is best-effort only.
  // Prefer reading `cwd` from a real event when possible.
  if (!id) return "";
  const trimmed = id.startsWith("-") ? id.slice(1) : id;
  return "/" + trimmed.split("-").join("/");
}

async function pMap(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function readJsonl(filePath, opts = {}) {
  const { limit, fromEnd } = opts;
  let text;
  try {
    text = await fsp.readFile(filePath, "utf-8");
  } catch {
    return [];
  }
  const out = [];
  // simple line split
  const lines = text.split("\n");
  const iter = fromEnd ? lines.slice().reverse() : lines;
  for (const line of iter) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
    if (limit && out.length >= limit) break;
  }
  return fromEnd ? out.reverse() : out;
}

async function firstCwdInJsonl(filePath) {
  try {
    const fh = await fsp.open(filePath, "r");
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    await fh.close();
    const text = buf.subarray(0, bytesRead).toString("utf-8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (typeof obj.cwd === "string" && obj.cwd) return obj.cwd;
      } catch {}
    }
  } catch {}
  return null;
}

async function listProjects() {
  const root = projectsRoot();
  let entries;
  try {
    entries = await fsp.readdir(root);
  } catch {
    return [];
  }
  const result = await pMap(entries, 6, async (name) => {
    const dir = path.join(root, name);
    let stat;
    try {
      stat = await fsp.stat(dir);
    } catch {
      return null;
    }
    if (!stat.isDirectory()) return null;
    const files = await fsp.readdir(dir).catch(() => []);
    let sessionCount = 0;
    let lastModified = stat.mtime;
    let mostRecentJsonl = null;
    let mostRecentMtime = 0;
    const jsonl = files.filter((f) => f.endsWith(".jsonl"));
    const stats = await pMap(jsonl, 6, async (f) => {
      try {
        return { f, s: await fsp.stat(path.join(dir, f)) };
      } catch {
        return null;
      }
    });
    for (const r of stats) {
      if (!r) continue;
      sessionCount++;
      if (r.s.mtime > lastModified) lastModified = r.s.mtime;
      if (r.s.mtime.getTime() > mostRecentMtime) {
        mostRecentMtime = r.s.mtime.getTime();
        mostRecentJsonl = path.join(dir, r.f);
      }
    }
    let cwd = decodeProjectId(name);
    if (mostRecentJsonl) {
      const real = await firstCwdInJsonl(mostRecentJsonl);
      if (real) cwd = real;
    }
    return {
      id: name,
      path: cwd,
      sessionCount,
      lastModified: lastModified.toISOString(),
    };
  });
  return result
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(b.lastModified).getTime() -
        new Date(a.lastModified).getTime(),
    );
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "tool_result") {
      if (typeof b.content === "string") parts.push(b.content);
      else if (Array.isArray(b.content)) {
        for (const sub of b.content) {
          if (sub && typeof sub.text === "string") parts.push(sub.text);
        }
      }
    }
  }
  return parts.join("\n");
}

async function summarizeSession(filePath, projectId) {
  const events = await readJsonl(filePath);
  let title = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let messageCount = 0;
  let toolUseCount = 0;
  let gitBranch;
  let cwd;
  let aiTitle, customTitle, agentName, firstUserText;
  let inputTok = 0, outputTok = 0, cacheRead = 0, cacheCreate = 0;
  const toolCounts = {};
  for (const ev of events) {
    if (ev.timestamp) {
      if (!firstTimestamp) firstTimestamp = ev.timestamp;
      lastTimestamp = ev.timestamp;
    }
    if (ev.gitBranch && !gitBranch) gitBranch = ev.gitBranch;
    if (ev.cwd && !cwd) cwd = ev.cwd;
    if (ev.type === "user" || ev.type === "assistant") messageCount++;
    if (ev.type === "ai-title" && ev.aiTitle) aiTitle = ev.aiTitle;
    if (ev.type === "custom-title" && ev.customTitle) customTitle = ev.customTitle;
    if (ev.type === "agent-name" && ev.agentName) agentName = ev.agentName;
    if (ev.type === "user" && !firstUserText) {
      const c = ev.message?.content;
      if (typeof c === "string") firstUserText = c;
      else if (Array.isArray(c)) {
        for (const b of c) {
          if (b?.type === "text" && b.text) {
            firstUserText = b.text;
            break;
          }
        }
      }
    }
    if (ev.type === "assistant") {
      const c = ev.message?.content;
      if (Array.isArray(c)) {
        for (const b of c) {
          if (b?.type === "tool_use") {
            toolUseCount++;
            toolCounts[b.name || "?"] = (toolCounts[b.name || "?"] || 0) + 1;
          }
        }
      }
      const u = ev.message?.usage;
      if (u) {
        inputTok += u.input_tokens || 0;
        outputTok += u.output_tokens || 0;
        cacheRead += u.cache_read_input_tokens || 0;
        cacheCreate += u.cache_creation_input_tokens || 0;
      }
    }
  }
  title =
    customTitle ||
    agentName ||
    aiTitle ||
    (firstUserText
      ? firstUserText
          .trim()
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .slice(0, 80)
      : path.basename(filePath, ".jsonl").slice(0, 8));
  return {
    id: path.basename(filePath, ".jsonl"),
    projectId,
    filePath,
    title,
    firstTimestamp,
    lastTimestamp,
    messageCount,
    toolUseCount,
    toolCounts,
    gitBranch,
    cwd,
    usage: {
      input: inputTok,
      output: outputTok,
      cacheRead,
      cacheCreate,
      total: inputTok + outputTok + cacheRead + cacheCreate,
    },
  };
}

async function listSessions(projectIdFilter) {
  const root = projectsRoot();
  const projects = projectIdFilter
    ? [projectIdFilter]
    : (await fsp.readdir(root).catch(() => []));
  const out = [];
  for (const projectId of projects) {
    const dir = path.join(root, projectId);
    let files;
    try {
      files = await fsp.readdir(dir);
    } catch {
      continue;
    }
    const jsonl = files
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(dir, f));
    const summaries = await pMap(jsonl, 6, (f) =>
      summarizeSession(f, projectId),
    );
    out.push(...summaries);
  }
  out.sort((a, b) => {
    const at = a.lastTimestamp ? new Date(a.lastTimestamp).getTime() : 0;
    const bt = b.lastTimestamp ? new Date(b.lastTimestamp).getTime() : 0;
    return bt - at;
  });
  return out;
}

async function resolveSession(idOrPrefix, projectIdHint) {
  const root = projectsRoot();
  const projects = projectIdHint
    ? [projectIdHint]
    : (await fsp.readdir(root).catch(() => []));
  const matches = [];
  for (const projectId of projects) {
    const dir = path.join(root, projectId);
    let files;
    try {
      files = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const id = f.slice(0, -6);
      if (id === idOrPrefix || id.startsWith(idOrPrefix)) {
        matches.push({ id, projectId, filePath: path.join(dir, f) });
      }
    }
  }
  if (matches.length === 0) {
    throw new Error(`No session matches "${idOrPrefix}".`);
  }
  if (matches.length > 1) {
    const list = matches.map((m) => `  ${m.id}  (${m.projectId})`).join("\n");
    throw new Error(
      `Ambiguous prefix "${idOrPrefix}" matched ${matches.length} sessions:\n${list}`,
    );
  }
  return matches[0];
}

async function loadSession(idOrPrefix, projectIdHint, opts) {
  const { filePath, id, projectId } = await resolveSession(
    idOrPrefix,
    projectIdHint,
  );
  const events = await readJsonl(filePath, opts);
  return { id, projectId, filePath, events };
}

// Simple substring search across all sessions.
async function searchAll(query, opts = {}) {
  const q = (query || "").toLowerCase();
  if (!q) return [];
  const { limit = 50, projectId: filter } = opts;
  const root = projectsRoot();
  const projects = filter
    ? [filter]
    : (await fsp.readdir(root).catch(() => []));
  const hits = [];
  for (const projectId of projects) {
    if (hits.length >= limit) break;
    const dir = path.join(root, projectId);
    let files;
    try {
      files = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (hits.length >= limit) break;
      if (!f.endsWith(".jsonl")) continue;
      const sessionId = f.slice(0, -6);
      const filePath = path.join(dir, f);
      const events = await readJsonl(filePath);
      for (const ev of events) {
        if (ev.type !== "user" && ev.type !== "assistant") continue;
        const c = ev.message?.content;
        let texts = [];
        if (typeof c === "string") texts.push({ t: c, kind: "text" });
        else if (Array.isArray(c)) {
          for (const b of c) {
            if (!b) continue;
            if (b.type === "text" && b.text) texts.push({ t: b.text, kind: "text" });
            else if (b.type === "thinking" && b.thinking)
              texts.push({ t: b.thinking, kind: "thinking" });
            else if (b.type === "tool_use" && b.input)
              texts.push({
                t: typeof b.input === "string" ? b.input : JSON.stringify(b.input),
                kind: "tool_input",
                tool: b.name,
              });
            else if (b.type === "tool_result") {
              const t = extractText([b]);
              if (t) texts.push({ t, kind: "tool_result" });
            }
          }
        }
        for (const { t, kind, tool } of texts) {
          const idx = t.toLowerCase().indexOf(q);
          if (idx >= 0) {
            const start = Math.max(0, idx - 60);
            const end = Math.min(t.length, idx + q.length + 80);
            hits.push({
              projectId,
              sessionId,
              eventUuid: ev.uuid,
              role: ev.type,
              tool,
              matchType: kind,
              excerpt:
                (start > 0 ? "…" : "") +
                t.slice(start, end).replace(/\s+/g, " ") +
                (end < t.length ? "…" : ""),
              timestamp: ev.timestamp,
            });
            if (hits.length >= limit) break;
          }
        }
        if (hits.length >= limit) break;
      }
    }
  }
  return hits;
}

module.exports = {
  projectsRoot,
  listProjects,
  listSessions,
  resolveSession,
  loadSession,
  readJsonl,
  searchAll,
  summarizeSession,
  extractText,
};
