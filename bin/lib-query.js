// Standalone query helpers used by the CLI subcommands.
// Pure Node — no Next.js / TS runtime needed.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

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

// ─── Claude project/session listing ───────────────────────────────────────

async function listClaudeProjects() {
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
      source: "claude",
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
    source: "claude",
    usage: {
      input: inputTok,
      output: outputTok,
      cacheRead,
      cacheCreate,
      total: inputTok + outputTok + cacheRead + cacheCreate,
    },
  };
}

async function listClaudeSessions(projectIdFilter) {
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

// ─── Codex helpers ────────────────────────────────────────────────────────

function codexSessionsRoot() {
  return (
    process.env.CCSV_CODEX_DIR ||
    path.join(os.homedir(), ".codex", "sessions")
  );
}

async function findRolloutFiles() {
  const root = codexSessionsRoot();
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (
        e.isFile() &&
        e.name.startsWith("rollout-") &&
        e.name.endsWith(".jsonl")
      )
        out.push(full);
    }
  }
  await walk(root);
  return out;
}

function sessionIdFromRolloutPath(filePath) {
  const base = path.basename(filePath, ".jsonl"); // rollout-2026-...-<uuid>
  const m = base.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  return m ? m[1] : base;
}

// Stable short id for a cwd → used as the Codex project rawId (sha1 hex, 16 chars).
function codexProjectId(cwd) {
  return crypto.createHash("sha1").update(cwd).digest("hex").slice(0, 16);
}

// Parse Codex tool arguments JSON (may be string-encoded).
function parseArgs(raw) {
  if (typeof raw !== "string") {
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw
      : {};
  }
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : { _raw: raw };
  } catch {
    return { _raw: raw };
  }
}

// Minimal apply_patch parser (mirrors the TS codex-parser.ts version).
function parseApplyPatch(patch) {
  const lines = patch.split("\n");
  let file = "";
  const oldLines = [];
  const newLines = [];
  let inBody = false;
  for (const ln of lines) {
    const upd = ln.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
    if (upd) {
      if (file) break; // only the first file
      file = upd[1].trim();
      inBody = true;
      continue;
    }
    if (ln.startsWith("*** ")) {
      inBody = false;
      continue;
    }
    if (!inBody) continue;
    if (ln.startsWith("@@")) continue;
    if (ln.startsWith("-")) oldLines.push(ln.slice(1));
    else if (ln.startsWith("+")) newLines.push(ln.slice(1));
    else if (ln.startsWith(" ")) {
      oldLines.push(ln.slice(1));
      newLines.push(ln.slice(1));
    }
  }
  if (!file) return null;
  return {
    file_path: file,
    old_string: oldLines.join("\n"),
    new_string: newLines.join("\n"),
  };
}

// Remap Codex tool arguments onto the field names the CLI renderer expects.
function remapToolInput(name, args) {
  switch (name) {
    case "exec_command":
      return { ...args, command: args["cmd"] ?? args["command"] ?? "" };
    case "write_stdin":
      return { ...args, command: args["chars"] ?? "" };
    case "apply_patch": {
      const raw = String(args["input"] ?? args["patch"] ?? "");
      const parsed = parseApplyPatch(raw);
      return parsed ? { ...parsed, _raw: raw } : { _raw: raw };
    }
    default:
      return args;
  }
}

// Extract text from Codex content array (items like {type:"input_text"|"output_text", text}).
function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((it) =>
      it && typeof it === "object" && typeof it.text === "string"
        ? it.text
        : "",
    )
    .join("");
}

// Extract text from Codex reasoning.summary array items like {type:"summary_text", text}.
function textFromSummary(summary) {
  return summary
    .map((s) =>
      s && typeof s === "object" && typeof s.text === "string"
        ? s.text
        : typeof s === "string"
          ? s
          : "",
    )
    .filter(Boolean)
    .join("\n");
}

function roleToEventType(role) {
  if (role === "assistant") return "assistant";
  if (role === "developer") return "system";
  return "user";
}

/**
 * Transform Codex rollout lines into Claude-shaped events.
 * Each line has the envelope shape: {timestamp, type, payload}.
 * The parser checks payload.type to determine the event kind.
 * Emits events with the same shape (type, uuid, timestamp, message) as
 * the existing Claude events so the CLI renderers work unchanged.
 */
function parseCodexRollout(lines, sessionId) {
  const events = [];
  let i = 0;
  const mkUuid = (n) => `${sessionId}:${n}`;

  for (const ln of lines) {
    const p = ln.payload;
    if (!p || typeof p !== "object") continue;
    const ptype = p["type"];
    const ts = ln.timestamp ?? null;
    const uuid = mkUuid(i++);

    if (ptype === "message") {
      const role = String(p["role"] ?? "user");
      const text = textFromContent(p["content"]);
      if (!text.trim()) continue;
      const evType = roleToEventType(role);
      // Keep developer→system events (collapsed/muted), matching the web
      // parser (lib/codex-parser.ts) so CLI and web transcripts agree.
      events.push({
        type: evType,
        uuid,
        timestamp: ts,
        message: {
          role: evType === "assistant" ? "assistant" : "user",
          content: [{ type: "text", text }],
        },
      });
    } else if (ptype === "reasoning") {
      const summary = p["summary"];
      const content = p["content"];
      const hasText =
        (typeof content === "string" && content.trim()) ||
        (Array.isArray(summary) && summary.length > 0);
      const thinking = hasText
        ? typeof content === "string"
          ? content
          : textFromSummary(Array.isArray(summary) ? summary : [])
        : "(reasoning encrypted — content not stored in the rollout)";
      events.push({
        type: "assistant",
        uuid,
        timestamp: ts,
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking }],
        },
      });
    } else if (ptype === "function_call") {
      const name = String(p["name"] ?? "tool");
      const callId = String(p["call_id"] ?? uuid);
      const input = remapToolInput(name, parseArgs(p["arguments"]));
      events.push({
        type: "assistant",
        uuid,
        timestamp: ts,
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: callId, name, input }],
        },
      });
    } else if (ptype === "function_call_output") {
      const callId = String(p["call_id"] ?? uuid);
      events.push({
        type: "user",
        uuid,
        timestamp: ts,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: callId,
              content: String(p["output"] ?? ""),
            },
          ],
        },
      });
    }
    // event_msg (task_started/user_message/agent_message/token_count) is
    // intentionally dropped: response_item already carries the canonical
    // message; the event_msg variants are duplicates or runtime chatter.
  }

  return events;
}

// Summarize a single Codex rollout file.
async function summarizeRollout(filePath) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return null;
  }
  const lines = await readJsonl(filePath);
  let cwd = "";
  let title = "(codex session)";
  let firstTimestamp = null;
  let lastTimestamp = null;
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
      cwd = p["cwd"];
    }
    if (p["type"] === "message") {
      messageCount++;
      if (
        title === "(codex session)" &&
        p["role"] === "user" &&
        Array.isArray(p["content"])
      ) {
        const t = p["content"]
          .map((x) => (x && typeof x.text === "string" ? x.text : ""))
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

async function allRollouts() {
  const files = await findRolloutFiles();
  const infos = await pMap(files, 6, (f) => summarizeRollout(f));
  return infos.filter(Boolean);
}

async function listCodexProjects() {
  const rollouts = await allRollouts();
  const byCwd = new Map();
  for (const r of rollouts) {
    const arr = byCwd.get(r.cwd) ?? [];
    arr.push(r);
    byCwd.set(r.cwd, arr);
  }
  const projects = [];
  for (const [cwd, rs] of byCwd) {
    const last = Math.max(...rs.map((r) => r.mtimeMs));
    const rawId = codexProjectId(cwd);
    projects.push({
      id: "codex:" + rawId,
      path: cwd,
      sessionCount: rs.length,
      lastModified: new Date(last).toISOString(),
      source: "codex",
    });
  }
  return projects;
}

async function listCodexSessions(rawProjectId) {
  const rollouts = await allRollouts();
  const now = Date.now();
  const out = [];
  for (const r of rollouts) {
    // If rawProjectId is provided, filter to matching project only
    if (rawProjectId && codexProjectId(r.cwd) !== rawProjectId) continue;
    const pId = codexProjectId(r.cwd);
    out.push({
      id: r.sessionId,
      projectId: "codex:" + pId,
      filePath: r.filePath,
      title: r.title,
      firstTimestamp: r.firstTimestamp,
      lastTimestamp: r.lastTimestamp,
      messageCount: r.messageCount,
      toolUseCount: r.toolUseCount,
      toolCounts: {},
      cwd: r.cwd,
      source: "codex",
      // Codex sessions have no token usage tracking
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 },
    });
  }
  out.sort((a, b) => {
    const at = a.lastTimestamp ? Date.parse(a.lastTimestamp) : 0;
    const bt = b.lastTimestamp ? Date.parse(b.lastTimestamp) : 0;
    return bt - at;
  });
  return out;
}

async function loadCodexSession(sessionId) {
  const files = await findRolloutFiles();
  const file = files.find((f) => sessionIdFromRolloutPath(f) === sessionId);
  if (!file) return null;
  const lines = await readJsonl(file);
  const events = parseCodexRollout(lines, sessionId);
  return { id: sessionId, projectId: null, filePath: file, events, source: "codex" };
}

// ─── Source routing helpers ───────────────────────────────────────────────

/**
 * Decode whether a project id is from codex (prefixed with "codex:") or claude.
 * Returns { source: "codex"|"claude", rawId: string }.
 */
function decodeSource(projectId) {
  if (projectId && projectId.startsWith("codex:")) {
    return { source: "codex", rawId: projectId.slice("codex:".length) };
  }
  return { source: "claude", rawId: projectId };
}

// ─── Combined public API ──────────────────────────────────────────────────

async function listProjects(opts = {}) {
  const { source = "all" } = opts;
  const parts = [];
  if (source === "all" || source === "claude") {
    parts.push(...(await listClaudeProjects()));
  }
  if (source === "all" || source === "codex") {
    parts.push(...(await listCodexProjects()));
  }
  // Sort combined list by lastModified descending
  parts.sort(
    (a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );
  return parts;
}

async function listSessions(projectId, opts = {}) {
  const { source = "all" } = typeof opts === "object" ? opts : {};

  // If a projectId is provided, route by its prefix
  if (projectId) {
    const { source: src, rawId } = decodeSource(projectId);
    if (src === "codex") {
      return listCodexSessions(rawId);
    }
    return listClaudeSessions(rawId);
  }

  // No projectId — list across all sources per filter
  const parts = [];
  if (source === "all" || source === "claude") {
    parts.push(...(await listClaudeSessions(null)));
  }
  if (source === "all" || source === "codex") {
    parts.push(...(await listCodexSessions(null)));
  }
  parts.sort((a, b) => {
    const at = a.lastTimestamp ? new Date(a.lastTimestamp).getTime() : 0;
    const bt = b.lastTimestamp ? new Date(b.lastTimestamp).getTime() : 0;
    return bt - at;
  });
  return parts;
}

async function loadSession(idOrPrefix, projectIdHint, opts) {
  // If the hint is a codex project, load from codex directly
  if (projectIdHint && projectIdHint.startsWith("codex:")) {
    const result = await loadCodexSession(idOrPrefix);
    if (result) return result;
    throw new Error(`No Codex session found for "${idOrPrefix}".`);
  }

  // Try Claude first
  try {
    const { filePath, id, projectId } = await resolveSession(
      idOrPrefix,
      projectIdHint,
    );
    const events = await readJsonl(filePath, opts);
    return { id, projectId, filePath, events };
  } catch (err) {
    // If not found in Claude, try Codex (session uuid may be in Codex)
    const codexResult = await loadCodexSession(idOrPrefix);
    if (codexResult) return codexResult;
    throw err; // re-throw original Claude error
  }
}

// Simple substring search across all sessions.
async function searchAll(query, opts = {}) {
  const q = (query || "").toLowerCase();
  if (!q) return [];
  const { limit = 50, projectId: filter, source = "all" } = opts;

  const hits = [];

  // Search Claude sessions
  if (source === "all" || source === "claude") {
    const root = projectsRoot();
    const { source: _src, rawId: claudeFilter } = filter
      ? decodeSource(filter)
      : { source: null, rawId: null };
    const useFilter =
      !filter || (filter && !filter.startsWith("codex:")) ? filter : null;
    const projects = useFilter
      ? [useFilter]
      : (await fsp.readdir(root).catch(() => []));
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
        _searchEvents(events, q, projectId, sessionId, hits, limit, "claude");
      }
    }
  }

  // Search Codex sessions
  if (source === "all" || source === "codex") {
    if (hits.length < limit) {
      const files = await findRolloutFiles();
      for (const filePath of files) {
        if (hits.length >= limit) break;
        const sessionId = sessionIdFromRolloutPath(filePath);
        // Filter by project if requested
        if (filter && filter.startsWith("codex:")) {
          const rawId = filter.slice("codex:".length);
          const lines = await readJsonl(filePath);
          let cwd = "";
          for (const ln of lines) {
            if (ln.type === "session_meta" && ln.payload && typeof ln.payload["cwd"] === "string") {
              cwd = ln.payload["cwd"];
              break;
            }
          }
          if (codexProjectId(cwd) !== rawId) continue;
        }
        const lines = await readJsonl(filePath);
        const events = parseCodexRollout(lines, sessionId);
        const pId = "codex:" + sessionId; // approximate; good enough for display
        _searchEvents(events, q, pId, sessionId, hits, limit, "codex");
      }
    }
  }

  return hits;
}

// Internal helper: scan events for query hits, push into hits array.
function _searchEvents(events, q, projectId, sessionId, hits, limit, source) {
  for (const ev of events) {
    if (hits.length >= limit) return;
    if (ev.type !== "user" && ev.type !== "assistant") continue;
    const c = ev.message?.content;
    const texts = [];
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
          source,
          excerpt:
            (start > 0 ? "…" : "") +
            t.slice(start, end).replace(/\s+/g, " ") +
            (end < t.length ? "…" : ""),
          timestamp: ev.timestamp,
        });
        if (hits.length >= limit) return;
      }
    }
  }
}

module.exports = {
  projectsRoot,
  codexSessionsRoot,
  listProjects,
  listSessions,
  resolveSession,
  loadSession,
  readJsonl,
  searchAll,
  summarizeSession,
  extractText,
  // Exposed for tests / advanced use
  codexProjectId,
  sessionIdFromRolloutPath,
  findRolloutFiles,
  parseCodexRollout,
  decodeSource,
};
