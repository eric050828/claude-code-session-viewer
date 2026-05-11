// Subcommand implementations for ccsv. Each is async, writes to stdout, and
// returns an exit code.
const path = require("node:path");
const Q = require("./lib-query");

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
};
const noColor = !process.stdout.isTTY || process.env.NO_COLOR;
const c = (color, s) => (noColor ? s : C[color] + s + C.reset);

function relativeTime(ts) {
  if (!ts) return "";
  const diffMs = Date.now() - new Date(ts).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatTokens(n) {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + "k";
  return (n / 1e6).toFixed(2) + "M";
}

function getArg(args, ...names) {
  for (const name of names) {
    const i = args.indexOf(name);
    if (i >= 0 && i + 1 < args.length) return args[i + 1];
  }
  return undefined;
}
function hasFlag(args, ...names) {
  return names.some((n) => args.includes(n));
}

// ─── projects ──────────────────────────────────────────────────────────────
async function cmdProjects(args) {
  const json = hasFlag(args, "--json");
  const projects = await Q.listProjects();
  if (json) {
    process.stdout.write(JSON.stringify(projects, null, 2) + "\n");
    return 0;
  }
  if (!projects.length) {
    console.log("(no projects in " + Q.projectsRoot() + ")");
    return 0;
  }
  const maxPath = Math.max(...projects.map((p) => p.path.length));
  for (const p of projects) {
    console.log(
      c("cyan", p.path.padEnd(maxPath)) +
        "  " +
        c("dim", `${String(p.sessionCount).padStart(4)} sessions`) +
        "  " +
        c("dim", relativeTime(p.lastModified).padStart(8)) +
        "  " +
        c("dim", p.id),
    );
  }
  return 0;
}

// ─── sessions ─────────────────────────────────────────────────────────────
async function cmdSessions(args) {
  const json = hasFlag(args, "--json");
  const projectId = getArg(args, "--project", "-p");
  const limit = parseInt(getArg(args, "--limit", "-n") || "0", 10);
  let sessions = await Q.listSessions(projectId);
  if (limit > 0) sessions = sessions.slice(0, limit);
  if (json) {
    process.stdout.write(
      JSON.stringify(
        sessions.map(({ filePath, ...s }) => s),
        null,
        2,
      ) + "\n",
    );
    return 0;
  }
  if (!sessions.length) {
    console.log("(no sessions)");
    return 0;
  }
  for (const s of sessions) {
    const tools = s.toolUseCount ? c("dim", ` · ${s.toolUseCount} tools`) : "";
    const tokens = s.usage.total
      ? c("dim", ` · ${formatTokens(s.usage.total)} tok`)
      : "";
    const branch = s.gitBranch ? c("dim", ` · ${s.gitBranch}`) : "";
    console.log(
      c("bold", s.id.slice(0, 8)) +
        "  " +
        c("cyan", s.title.slice(0, 70)) +
        "\n  " +
        c("dim", relativeTime(s.lastTimestamp)) +
        c("dim", ` · ${s.messageCount} msgs`) +
        tools +
        tokens +
        branch +
        (s.cwd ? c("dim", ` · ${s.cwd}`) : ""),
    );
  }
  return 0;
}

// ─── show ─────────────────────────────────────────────────────────────────
async function cmdShow(args) {
  const id = args.find((a) => !a.startsWith("-"));
  if (!id) {
    console.error("Usage: ccsv show <session-id> [--format transcript|json|raw] [--limit N] [--thinking]");
    return 2;
  }
  const projectId = getArg(args, "--project", "-p");
  const format = getArg(args, "--format", "-f") || "transcript";
  const limit = parseInt(getArg(args, "--limit", "-n") || "0", 10);
  const showThinking = hasFlag(args, "--thinking");

  const session = await Q.loadSession(id, projectId, {});
  const events = limit > 0 ? session.events.slice(-limit) : session.events;

  if (format === "raw") {
    for (const ev of events) process.stdout.write(JSON.stringify(ev) + "\n");
    return 0;
  }
  if (format === "json") {
    process.stdout.write(JSON.stringify({ ...session, events }, null, 2) + "\n");
    return 0;
  }
  // transcript
  const meta = await Q.summarizeSession(session.filePath, session.projectId);
  console.log(c("bold", meta.title));
  console.log(
    c("dim", `${session.id}  ${meta.gitBranch ? "· " + meta.gitBranch + "  " : ""}· ${meta.cwd || ""}`),
  );
  console.log(
    c("dim", `${meta.messageCount} messages  · ${meta.toolUseCount} tool uses  · ${formatTokens(meta.usage.total)} tokens`),
  );
  console.log();

  for (const ev of events) {
    renderTranscriptEvent(ev, { showThinking });
  }
  return 0;
}

function renderTranscriptEvent(ev, opts) {
  const ts = ev.timestamp ? ev.timestamp.replace("T", " ").slice(0, 19) : "";
  if (ev.type === "user") {
    const c2 = ev.message?.content;
    const body = textOrBlocks(c2, { skipToolResults: true });
    if (!body.trim()) return; // pure tool-result envelope
    console.log(c("green", `\n[${ts} user]`));
    console.log(body);
  } else if (ev.type === "assistant") {
    const c2 = ev.message?.content;
    console.log(c("yellow", `\n[${ts} assistant]`));
    if (Array.isArray(c2)) {
      for (const b of c2) {
        if (!b) continue;
        if (b.type === "text" && b.text) {
          console.log(b.text);
        } else if (b.type === "thinking" && b.thinking && opts.showThinking) {
          console.log(c("dim", "[thinking]"));
          console.log(c("dim", b.thinking));
        } else if (b.type === "tool_use") {
          const inp = formatToolInput(b);
          console.log(c("magenta", `[tool: ${b.name}] ${inp}`));
        }
      }
    } else if (typeof c2 === "string") {
      console.log(c2);
    }
  } else if (ev.type === "system" && ev.subtype === "turn_duration") {
    if (ev.durationMs)
      console.log(c("dim", `\n--- turn: ${(ev.durationMs / 1000).toFixed(1)}s · ${ev.messageCount || 0} msgs ---`));
  }
}

function textOrBlocks(content, opts = {}) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const b of content) {
    if (!b) continue;
    if (b.type === "text" && b.text) parts.push(b.text);
    else if (b.type === "tool_result" && !opts.skipToolResults) {
      parts.push("[tool_result]");
    }
  }
  return parts.join("\n");
}

function formatToolInput(block) {
  const i = block.input || {};
  switch (block.name) {
    case "Bash":
      return (i.command || "").replace(/\s+/g, " ").slice(0, 200);
    case "Read":
      return i.file_path || "";
    case "Edit":
    case "MultiEdit":
      return i.file_path || "";
    case "Write":
      return i.file_path || "";
    case "Grep":
      return `/${i.pattern || ""}/ in ${i.path || "."}`;
    case "Glob":
      return `${i.pattern || ""} in ${i.path || "."}`;
    case "Task":
    case "Agent":
      return `(${i.subagent_type || "?"}) ${i.description || ""}`.slice(0, 200);
    case "WebFetch":
      return i.url || "";
    case "WebSearch":
      return i.query || "";
    case "TodoWrite": {
      const n = Array.isArray(i.todos) ? i.todos.length : 0;
      return `${n} todos`;
    }
    default: {
      try {
        const s = JSON.stringify(i);
        return s.length > 200 ? s.slice(0, 200) + "…" : s;
      } catch {
        return "";
      }
    }
  }
}

// ─── tail ─────────────────────────────────────────────────────────────────
async function cmdTail(args) {
  const id = args.find((a) => !a.startsWith("-"));
  if (!id) {
    console.error("Usage: ccsv tail <session-id> [--lines N] [--json]");
    return 2;
  }
  const projectId = getArg(args, "--project", "-p");
  const lines = parseInt(getArg(args, "--lines", "-n") || "20", 10);
  const json = hasFlag(args, "--json");
  const session = await Q.loadSession(id, projectId, {});
  // tail by "interesting" events only: user / assistant
  const interesting = session.events.filter(
    (e) => e.type === "user" || e.type === "assistant",
  );
  const slice = interesting.slice(-lines);
  if (json) {
    process.stdout.write(JSON.stringify(slice, null, 2) + "\n");
    return 0;
  }
  for (const ev of slice) renderTranscriptEvent(ev, { showThinking: false });
  return 0;
}

// ─── search ───────────────────────────────────────────────────────────────
async function cmdSearch(args) {
  const query = args.find((a) => !a.startsWith("-"));
  if (!query) {
    console.error("Usage: ccsv search <query> [--limit N] [--project ID] [--json]");
    return 2;
  }
  const limit = parseInt(getArg(args, "--limit", "-n") || "30", 10);
  const projectId = getArg(args, "--project", "-p");
  const json = hasFlag(args, "--json");
  const hits = await Q.searchAll(query, { limit, projectId });
  if (json) {
    process.stdout.write(JSON.stringify(hits, null, 2) + "\n");
    return 0;
  }
  if (!hits.length) {
    console.log("(no matches)");
    return 0;
  }
  for (const h of hits) {
    console.log(
      c("dim", `${h.matchType.padEnd(11)}`) +
        "  " +
        c("bold", h.sessionId.slice(0, 8)) +
        "  " +
        c("dim", relativeTime(h.timestamp)) +
        "\n  " +
        h.excerpt,
    );
  }
  return 0;
}

// ─── stats ────────────────────────────────────────────────────────────────
async function cmdStats(args) {
  const projectId = getArg(args, "--project", "-p");
  const json = hasFlag(args, "--json");
  const sessions = await Q.listSessions(projectId);
  const agg = {
    sessions: sessions.length,
    messages: 0,
    toolUses: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 },
    toolCounts: {},
    perProject: {},
  };
  for (const s of sessions) {
    agg.messages += s.messageCount;
    agg.toolUses += s.toolUseCount;
    for (const k of Object.keys(s.usage)) agg.usage[k] += s.usage[k] || 0;
    for (const [tool, n] of Object.entries(s.toolCounts || {})) {
      agg.toolCounts[tool] = (agg.toolCounts[tool] || 0) + n;
    }
    if (!agg.perProject[s.projectId]) {
      agg.perProject[s.projectId] = { sessions: 0, messages: 0, tokens: 0 };
    }
    const p = agg.perProject[s.projectId];
    p.sessions++;
    p.messages += s.messageCount;
    p.tokens += s.usage.total;
  }
  if (json) {
    process.stdout.write(JSON.stringify(agg, null, 2) + "\n");
    return 0;
  }
  console.log(c("bold", "Aggregate stats") + (projectId ? c("dim", ` for ${projectId}`) : ""));
  console.log(`  sessions:    ${agg.sessions}`);
  console.log(`  messages:    ${agg.messages}`);
  console.log(`  tool uses:   ${agg.toolUses}`);
  console.log(`  tokens:      ${formatTokens(agg.usage.total)}`);
  console.log(`    input:     ${formatTokens(agg.usage.input)}`);
  console.log(`    output:    ${formatTokens(agg.usage.output)}`);
  console.log(`    cacheRead: ${formatTokens(agg.usage.cacheRead)}`);
  console.log(`    cacheNew:  ${formatTokens(agg.usage.cacheCreate)}`);
  const top = Object.entries(agg.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (top.length) {
    console.log(c("bold", "\nTop tools"));
    for (const [t, n] of top) {
      console.log(`  ${t.padEnd(20)}  ${String(n).padStart(6)}`);
    }
  }
  return 0;
}

// ─── help ─────────────────────────────────────────────────────────────────
function cmdHelp() {
  console.log(`ccsv — Claude Code session viewer

Web UI:
  ccsv                          start local viewer on http://localhost:3838

Query commands (all support --json):
  ccsv projects                 list all projects
  ccsv sessions [-p PROJ_ID] [-n N]    list sessions (optionally per project)
  ccsv show <id> [-f transcript|json|raw] [-n N] [--thinking]
                                print a session (id may be 8-char prefix)
  ccsv tail <id> [-n 20]        print last N user/assistant messages
  ccsv search <query> [-n 30] [-p PROJ_ID]
                                substring search across all sessions
  ccsv stats [-p PROJ_ID]       aggregate tokens / tool counts / msg counts

Common flags:
  --json          machine-readable JSON output
  -p, --project   filter to a project id (use \`ccsv projects\` to find it)
  -n, --limit/--lines    limit results
  -h, --help

Env:
  CCSV_PROJECTS_DIR  override ~/.claude/projects path
  NO_COLOR=1         disable ANSI colours
`);
  return 0;
}

async function dispatch(name, args) {
  switch (name) {
    case "projects":
      return cmdProjects(args);
    case "sessions":
    case "ls":
      return cmdSessions(args);
    case "show":
    case "cat":
      return cmdShow(args);
    case "tail":
      return cmdTail(args);
    case "search":
    case "grep":
      return cmdSearch(args);
    case "stats":
      return cmdStats(args);
    case "help":
    case "--help":
    case "-h":
      cmdHelp();
      return 0;
    default:
      console.error(`Unknown command: ${name}`);
      console.error('Run "ccsv help" for usage.');
      return 2;
  }
}

module.exports = { dispatch, cmdHelp };
