# Codex Session Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read OpenAI Codex CLI session logs in the viewer with the same experience as Claude Code sessions — same renderers, search, URL state, keyboard nav, settings, and CLI.

**Architecture:** A Codex parser transforms Codex `rollout-*.jsonl` files into the existing Claude-shaped `SessionEvent[]`, so every existing renderer / search-index / conversation-view / minimap is reused unchanged. A thin source registry (`lib/sources/`) dispatches `listProjects/listSessions/loadSession` to either the Claude loader or the Codex parser, keyed by a `codex:` project-id prefix (unprefixed = Claude, for back-compat). A top-bar `All / Claude / Codex` toggle filters sources.

**Tech Stack:** Next.js 14, TypeScript, React, Tailwind. Tests via `vitest` (added in Task 0). UI verification via Playwright against mock fixtures.

Spec: `docs/superpowers/specs/2026-06-02-codex-session-support-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/sources/types.ts` *(new)* | `SessionSource` interface; `SourceId` type |
| `lib/sources/index.ts` *(new)* | Registry: encode/decode `codex:` prefix, dispatch, merge+tag |
| `lib/sources/claude.ts` *(new)* | Adapter wrapping existing `session-loader` exports, tagging `source: "claude"` |
| `lib/codex-paths.ts` *(new)* | Codex sessions root, rollout file discovery |
| `lib/codex-parser.ts` *(new)* | Pure transform: rollout lines → `SessionEvent[]`; tool-input remap; apply_patch parse |
| `lib/codex-loader.ts` *(new)* | cwd-based project grouping, `listSessions`, `loadSession` (uses codex-parser + cache) |
| `lib/types.ts` *(modify)* | Add `source` to `ProjectMeta` + `SessionMeta`; `source:` to `SearchHit` already has `via`, add `source` |
| `components/tool-renderers/index.tsx` *(modify)* | Register Codex tool names (`exec_command`, `write_stdin`, `apply_patch`) → existing renderers |
| `lib/settings.ts` *(modify)* | Add `sourceFilter: "all" | "claude" | "codex"` |
| `components/source-filter.tsx` *(new)* | The All/Claude/Codex segmented control |
| `components/top-bar.tsx` *(modify)* | Mount `<SourceFilter>` |
| `components/project-tree.tsx` *(modify)* | Filter by `settings.sourceFilter`; show source badge |
| `components/app-shell.tsx` *(modify)* | Pass projects through; nothing structural |
| `lib/search-index.ts` *(modify)* | Tag each indexed session with `source`; honor `source:` filter |
| `lib/query-parser.ts` *(modify)* | Add `source` operator |
| `app/api/projects/route.ts`, `app/api/sessions/[projectId]/route.ts`, `app/api/session/[projectId]/[sessionId]/route.ts` *(modify)* | Import from `@/lib/sources` instead of `@/lib/session-loader` |
| `bin/lib-query.js` *(modify)* | Codex reader + `--source` support |
| `bin/cli-commands.js` *(modify)* | `--source` flag plumbing |

---

## Task 0: Test infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: `vitest` appears in `devDependencies`.

- [ ] **Step 2: Add config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Add test script**

In `package.json` `scripts`, add:

```json
"test": "vitest run"
```

- [ ] **Step 4: Smoke test**

Create `lib/sanity.test.ts`:

```ts
import { test, expect } from "vitest";
test("vitest runs", () => { expect(1 + 1).toBe(2); });
```

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 5: Remove smoke test + commit**

```bash
rm lib/sanity.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add vitest runner for lib/ unit tests"
```

---

## Task 1: Add `source` to metadata types

**Files:**
- Modify: `lib/types.ts:173-194` (`ProjectMeta`, `SessionMeta`)

- [ ] **Step 1: Add the field to both interfaces**

In `lib/types.ts`, change `ProjectMeta` and `SessionMeta` to include:

```ts
export type SourceId = "claude" | "codex";

export interface ProjectMeta {
  id: string;
  decodedPath: string;
  sessionCount: number;
  lastModified: string;
  source: SourceId; // NEW — defaults to "claude" on the existing path
}

export interface SessionMeta {
  id: string;
  projectId: string;
  filePath: string;
  title: string;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  messageCount: number;
  toolUseCount: number;
  hasSubagents: boolean;
  gitBranch?: string;
  cwd?: string;
  fileSize: number;
  isActive: boolean;
  source: SourceId; // NEW
}
```

- [ ] **Step 2: Typecheck (expect failures to map the call sites)**

Run: `npx tsc --noEmit`
Expected: errors in `lib/session-loader.ts` where `ProjectMeta`/`SessionMeta` objects are built without `source`. That's the to-do list for Task 2.

- [ ] **Step 3: Commit the type change**

```bash
git add lib/types.ts
git commit -m "feat(types): add source field to ProjectMeta and SessionMeta"
```

---

## Task 2: Tag the Claude loader with `source: "claude"`

**Files:**
- Modify: `lib/session-loader.ts` (every `ProjectMeta`/`SessionMeta` construction + `CachedSummary`)

- [ ] **Step 1: Find the construction sites**

Run: `grep -n "sessionCount\|isActive:\|source:" lib/session-loader.ts`
Expected: the `listProjects` return object and the `listSessions` return object (around lines 153-157 and the project mapper).

- [ ] **Step 2: Add `source: "claude"` to the ProjectMeta build**

In `listProjects()`, wherever the `ProjectMeta` object literal is returned, add `source: "claude" as const,`.

- [ ] **Step 3: Add `source: "claude"` to the SessionMeta build**

In `listSessions()`, the final returned object (currently `{ ...summary, isActive: ... }`) becomes:

```ts
return {
  ...summary,
  isActive: now - stat.mtime.getTime() < ACTIVE_THRESHOLD_MS,
  source: "claude" as const,
};
```

`CachedSummary` is `Omit<SessionMeta, "isActive">` — it now includes `source`. The summary built in `summarizeSession` must also set `source: "claude"`. Add it to the object `summarizeSession` returns.

- [ ] **Step 4: Typecheck clean**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/session-loader.ts
git commit -m "feat(loader): tag Claude sessions with source"
```

---

## Task 3: Source registry skeleton

**Files:**
- Create: `lib/sources/types.ts`
- Create: `lib/sources/claude.ts`
- Create: `lib/sources/index.ts`
- Test: `lib/sources/index.test.ts`

- [ ] **Step 1: Write the failing test for prefix encode/decode**

Create `lib/sources/index.test.ts`:

```ts
import { test, expect } from "vitest";
import { encodeProjectId, decodeProjectId } from "./index";

test("claude ids are unprefixed (back-compat)", () => {
  expect(encodeProjectId("claude", "-home-eric")).toBe("-home-eric");
  expect(decodeProjectId("-home-eric")).toEqual({
    source: "claude",
    rawId: "-home-eric",
  });
});

test("codex ids carry a codex: prefix", () => {
  expect(encodeProjectId("codex", "abc123")).toBe("codex:abc123");
  expect(decodeProjectId("codex:abc123")).toEqual({
    source: "codex",
    rawId: "abc123",
  });
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm test -- lib/sources/index.test.ts`
Expected: FAIL — cannot find `./index`.

- [ ] **Step 3: Write `lib/sources/types.ts`**

```ts
import type { ProjectMeta, SessionEvent, SessionMeta, SubagentMeta } from "../types";

export interface SessionSource {
  id: "claude" | "codex";
  listProjects(): Promise<ProjectMeta[]>;
  listSessions(rawProjectId: string): Promise<SessionMeta[]>;
  loadSession(rawProjectId: string, sessionId: string): Promise<SessionEvent[]>;
  listSubagents(rawProjectId: string, sessionId: string): Promise<SubagentMeta[]>;
}
```

- [ ] **Step 4: Write `lib/sources/claude.ts`**

```ts
import {
  listProjects,
  listSessions,
  loadSession,
  listSubagents,
} from "../session-loader";
import type { SessionSource } from "./types";

export const claudeSource: SessionSource = {
  id: "claude",
  listProjects,
  listSessions,
  loadSession,
  listSubagents,
};
```

- [ ] **Step 5: Write `lib/sources/index.ts` (prefix logic + dispatch; codex stubbed for now)**

```ts
import type {
  ProjectMeta,
  SessionEvent,
  SessionMeta,
  SourceId,
  SubagentMeta,
} from "../types";
import { claudeSource } from "./claude";
import type { SessionSource } from "./types";

const CODEX_PREFIX = "codex:";

export function encodeProjectId(source: SourceId, rawId: string): string {
  return source === "codex" ? `${CODEX_PREFIX}${rawId}` : rawId;
}

export function decodeProjectId(id: string): { source: SourceId; rawId: string } {
  if (id.startsWith(CODEX_PREFIX)) {
    return { source: "codex", rawId: id.slice(CODEX_PREFIX.length) };
  }
  return { source: "claude", rawId: id };
}

// codexSource is wired in Task 6; until then it lists nothing.
const codexStub: SessionSource = {
  id: "codex",
  listProjects: async () => [],
  listSessions: async () => [],
  loadSession: async () => [],
  listSubagents: async () => [],
};

function sourceFor(source: SourceId): SessionSource {
  return source === "codex" ? codexStub : claudeSource;
}

/** All projects from every source, each tagged + prefixed. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const [claude, codex] = await Promise.all([
    claudeSource.listProjects(),
    codexStub.listProjects(),
  ]);
  return [
    ...claude.map((p) => ({ ...p, id: encodeProjectId("claude", p.id) })),
    ...codex.map((p) => ({ ...p, id: encodeProjectId("codex", p.id) })),
  ];
}

export async function listSessions(projectId: string): Promise<SessionMeta[]> {
  const { source, rawId } = decodeProjectId(projectId);
  const sessions = await sourceFor(source).listSessions(rawId);
  // Re-prefix the projectId each session reports so the client round-trips it.
  return sessions.map((s) => ({ ...s, projectId, source }));
}

export async function loadSession(
  projectId: string,
  sessionId: string,
): Promise<SessionEvent[]> {
  const { source, rawId } = decodeProjectId(projectId);
  return sourceFor(source).loadSession(rawId, sessionId);
}

export async function listSubagents(
  projectId: string,
  sessionId: string,
): Promise<SubagentMeta[]> {
  const { source, rawId } = decodeProjectId(projectId);
  return sourceFor(source).listSubagents(rawId, sessionId);
}
```

- [ ] **Step 6: Run the test, expect pass**

Run: `npm test -- lib/sources/index.test.ts`
Expected: 2 passed.

- [ ] **Step 7: Point the API routes at the registry**

In all three route files, change the import source from `@/lib/session-loader` to `@/lib/sources`:
- `app/api/projects/route.ts`: `import { listProjects } from "@/lib/sources";`
- `app/api/sessions/[projectId]/route.ts`: `import { listSessions } from "@/lib/sources";`
- `app/api/session/[projectId]/[sessionId]/route.ts`: `import { listSubagents, loadSession } from "@/lib/sources";`

(`warmSearchIndex` import in `projects/route.ts` stays from `@/lib/search-index`.)

- [ ] **Step 8: Build + smoke test the Claude path still works**

Run: `npm run build`
Expected: compiles. Then `CCSV_PROJECTS_DIR=/tmp/mock-projects node bin/cli.js --no-open --port 3841` and `curl -s localhost:3841/api/projects` returns the mock project with `"source":"claude"` and an unprefixed id. Kill the server.

- [ ] **Step 9: Commit**

```bash
git add lib/sources app/api
git commit -m "feat(sources): registry with codex: prefix routing; Claude unchanged"
```

---

## Task 4: Codex paths + rollout discovery

**Files:**
- Create: `lib/codex-paths.ts`
- Test: `lib/codex-paths.test.ts`

- [ ] **Step 1: Failing test**

Create `lib/codex-paths.test.ts`:

```ts
import { test, expect } from "vitest";
import { codexSessionsRoot } from "./codex-paths";

test("honors CCSV_CODEX_DIR override", () => {
  const prev = process.env.CCSV_CODEX_DIR;
  process.env.CCSV_CODEX_DIR = "/tmp/mock-codex";
  expect(codexSessionsRoot()).toBe("/tmp/mock-codex");
  if (prev === undefined) delete process.env.CCSV_CODEX_DIR;
  else process.env.CCSV_CODEX_DIR = prev;
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npm test -- lib/codex-paths.test.ts`
Expected: FAIL — cannot find `./codex-paths`.

- [ ] **Step 3: Implement**

Create `lib/codex-paths.ts`:

```ts
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
  // uuid is the last 5 dash groups (8-4-4-4-12); take everything after the
  // timestamp by matching the uuid at the end.
  const m = base.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  return m ? m[1] : base;
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- lib/codex-paths.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/codex-paths.ts lib/codex-paths.test.ts
git commit -m "feat(codex): sessions root + rollout file discovery"
```

---

## Task 5: Codex parser — envelope, dedup, messages, reasoning

**Files:**
- Create: `lib/codex-parser.ts`
- Test: `lib/codex-parser.test.ts`

This task produces `SessionEvent[]` for messages and reasoning only; tool pairing is Task 6.

- [ ] **Step 1: Failing test**

Create `lib/codex-parser.test.ts`:

```ts
import { test, expect } from "vitest";
import { parseCodexRollout } from "./codex-parser";

const lines = [
  { timestamp: "2026-06-01T18:00:00Z", type: "session_meta", payload: { id: "s1", cwd: "/home/eric/proj", timestamp: "2026-06-01T18:00:00Z" } },
  { timestamp: "2026-06-01T18:00:01Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] } },
  { timestamp: "2026-06-01T18:00:02Z", type: "event_msg", payload: { type: "user_message", message: "hello" } },
  { timestamp: "2026-06-01T18:00:03Z", type: "response_item", payload: { type: "reasoning", summary: "[]", content: null, encrypted_content: "gAAA..." } },
  { timestamp: "2026-06-01T18:00:04Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi there" }] } },
  { timestamp: "2026-06-01T18:00:05Z", type: "event_msg", payload: { type: "agent_message", message: "hi there" } },
];

test("dedups event_msg against response_item; maps roles + reasoning", () => {
  const events = parseCodexRollout(lines, "s1");
  const types = events.map((e) => e.type);
  // user message, reasoning(assistant+thinking), assistant message — no event_msg dupes
  expect(types).toEqual(["user", "assistant", "assistant"]);
  const user = events[0] as any;
  expect(user.message.content[0]).toMatchObject({ type: "text", text: "hello" });
  const reasoning = events[1] as any;
  expect(reasoning.message.content[0].type).toBe("thinking");
  expect(reasoning.message.content[0].thinking).toContain("encrypted");
  const asst = events[2] as any;
  expect(asst.message.content[0]).toMatchObject({ type: "text", text: "hi there" });
});

test("developer role maps to system", () => {
  const events = parseCodexRollout(
    [{ timestamp: "t", type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "<permissions>" }] } }],
    "s2",
  );
  expect(events[0].type).toBe("system");
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npm test -- lib/codex-parser.test.ts`
Expected: FAIL — cannot find `./codex-parser`.

- [ ] **Step 3: Implement messages + reasoning + dedup**

Create `lib/codex-parser.ts`:

```ts
import type { SessionEvent } from "./types";

interface Envelope {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

// Codex message content items: { type: "input_text" | "output_text", text }
function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((it) =>
      it && typeof it === "object" && typeof (it as { text?: string }).text === "string"
        ? (it as { text: string }).text
        : "",
    )
    .join("");
}

function roleToEventType(role: string): "user" | "assistant" | "system" {
  if (role === "assistant") return "assistant";
  if (role === "developer") return "system"; // system/permissions noise — collapsed
  return "user";
}

/**
 * Transform Codex rollout lines into Claude-shaped SessionEvents.
 * Messages + reasoning only here; tool calls are added in addToolEvents()
 * (Task 6) which this function calls.
 */
export function parseCodexRollout(
  lines: Envelope[],
  sessionId: string,
): SessionEvent[] {
  const events: SessionEvent[] = [];
  let i = 0;
  const mkUuid = (n: number) => `${sessionId}:${n}`;

  // Pre-index function_call_output by call_id for pairing (used in Task 6).
  const outputs = new Map<string, string>();
  for (const ln of lines) {
    const p = ln.payload;
    if (p && p["type"] === "function_call_output" && typeof p["call_id"] === "string") {
      outputs.set(p["call_id"] as string, String(p["output"] ?? ""));
    }
  }

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
      events.push({
        type: roleToEventType(role),
        uuid,
        timestamp: ts,
        message: { role: roleToEventType(role) === "assistant" ? "assistant" : "user", content: [{ type: "text", text }] },
      } as unknown as SessionEvent);
    } else if (ptype === "reasoning") {
      const summary = p["summary"];
      const content = p["content"];
      const hasText =
        (typeof content === "string" && content.trim()) ||
        (Array.isArray(summary) && summary.length > 0);
      const thinking = hasText
        ? typeof content === "string"
          ? content
          : (summary as unknown[]).map((s) => String(s)).join("\n")
        : "(reasoning encrypted — content not stored in the rollout)";
      events.push({
        type: "assistant",
        uuid,
        timestamp: ts,
        message: { role: "assistant", content: [{ type: "thinking", thinking }] },
      } as unknown as SessionEvent);
    }
    // function_call / function_call_output handled in Task 6 (addToolEvents).
    // event_msg (agent_message/user_message/task_started/token_count) is
    // intentionally dropped: response_item already carries the canonical
    // message; the event_msg variants are duplicates or runtime chatter.
  }

  return events;
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- lib/codex-parser.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/codex-parser.ts lib/codex-parser.test.ts
git commit -m "feat(codex): parse messages + reasoning; dedup event_msg"
```

---

## Task 6: Codex parser — tool calls (pairing + input remap)

**Files:**
- Modify: `lib/codex-parser.ts`
- Modify: `lib/codex-parser.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `lib/codex-parser.test.ts`:

```ts
test("exec_command becomes a tool_use(Bash) + tool_result pair", () => {
  const lines = [
    { timestamp: "t1", type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "ls -la" }), call_id: "c1" } },
    { timestamp: "t2", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "total 0\n" } },
  ];
  const events = parseCodexRollout(lines, "s3");
  const toolUse = events.find((e: any) => e.message?.content?.[0]?.type === "tool_use") as any;
  expect(toolUse.message.content[0].name).toBe("exec_command");
  expect(toolUse.message.content[0].input.command).toBe("ls -la");
  const result = events.find((e: any) => e.message?.content?.[0]?.type === "tool_result") as any;
  expect(result.message.content[0].content).toContain("total 0");
  expect(result.message.content[0].tool_use_id).toBe(toolUse.message.content[0].id);
});

test("unknown MCP tool keeps its name and raw JSON input", () => {
  const lines = [
    { timestamp: "t1", type: "response_item", payload: { type: "function_call", name: "meet_join", arguments: JSON.stringify({ meet_url: "x" }), call_id: "c2" } },
    { timestamp: "t2", type: "response_item", payload: { type: "function_call_output", call_id: "c2", output: "joined" } },
  ];
  const events = parseCodexRollout(lines, "s4");
  const toolUse = events.find((e: any) => e.message?.content?.[0]?.type === "tool_use") as any;
  expect(toolUse.message.content[0].name).toBe("meet_join");
  expect(toolUse.message.content[0].input.meet_url).toBe("x");
});

test("malformed arguments fall back to a raw string input", () => {
  const events = parseCodexRollout(
    [{ timestamp: "t", type: "response_item", payload: { type: "function_call", name: "x", arguments: "{not json", call_id: "c3" } }],
    "s5",
  );
  const toolUse = events.find((e: any) => e.message?.content?.[0]?.type === "tool_use") as any;
  expect(toolUse.message.content[0].input).toEqual({ _raw: "{not json" });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npm test -- lib/codex-parser.test.ts`
Expected: the three new tests FAIL (no tool events emitted yet).

- [ ] **Step 3: Add tool input remapping + emit in the loop**

In `lib/codex-parser.ts`, add above `parseCodexRollout`:

```ts
// Remap Codex tool arguments onto the field names the borrowed renderer
// expects. The card keeps the REAL Codex tool name (see registry in
// components/tool-renderers/index.tsx); only the input shape is adapted.
function remapToolInput(name: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case "exec_command":
      // Bash renderer wants { command }
      return { ...args, command: args["cmd"] ?? args["command"] ?? "" };
    case "write_stdin":
      // Bash renderer; show the written chars as the command line.
      return { ...args, command: args["chars"] ?? "" };
    case "apply_patch":
      // Edit renderer mapping is done in Task 7 (parseApplyPatch).
      return args;
    default:
      return args;
  }
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return (raw as Record<string, unknown>) ?? {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : { _raw: raw };
  } catch {
    return { _raw: raw };
  }
}
```

Then inside the `for (const ln of lines)` loop, add a branch (before the trailing comment):

```ts
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
      } as unknown as SessionEvent);
    } else if (ptype === "function_call_output") {
      const callId = String(p["call_id"] ?? uuid);
      events.push({
        type: "user",
        uuid,
        timestamp: ts,
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: callId, content: String(p["output"] ?? "") },
          ],
        },
      } as unknown as SessionEvent);
    }
```

(The pre-built `outputs` map from Task 5 is no longer needed since we emit the output event inline in file order — delete the `outputs` map block to keep it clean.)

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- lib/codex-parser.test.ts`
Expected: all pass.

- [ ] **Step 5: Register Codex tool names against existing renderers**

In `components/tool-renderers/index.tsx`, add to `REGISTRY`:

```ts
  // Codex tools — borrow Claude renderers; real name shown on the card.
  exec_command: BashRenderer,
  write_stdin: BashRenderer,
  apply_patch: EditRenderer,
```

- [ ] **Step 6: Build + commit**

Run: `npm run build`
Expected: compiles.

```bash
git add lib/codex-parser.ts lib/codex-parser.test.ts components/tool-renderers/index.tsx
git commit -m "feat(codex): pair function_call/output; map tools to renderers"
```

---

## Task 7: apply_patch → Edit renderer input

**Files:**
- Modify: `lib/codex-parser.ts`
- Modify: `lib/codex-parser.test.ts`

Codex `apply_patch` arguments are a single string in the `*** Begin Patch` format. Parse it into `{ file_path, old_string, new_string }` so the Edit renderer's diff works.

- [ ] **Step 1: Failing test**

Append to `lib/codex-parser.test.ts`:

```ts
test("apply_patch maps to Edit input with file_path + strings", () => {
  const patch = [
    "*** Begin Patch",
    "*** Update File: src/app.ts",
    "@@",
    "-const a = 1;",
    "+const a = 2;",
    "*** End Patch",
  ].join("\n");
  const events = parseCodexRollout(
    [{ timestamp: "t", type: "response_item", payload: { type: "function_call", name: "apply_patch", arguments: JSON.stringify({ input: patch }), call_id: "c9" } }],
    "s6",
  );
  const toolUse = events.find((e: any) => e.message?.content?.[0]?.type === "tool_use") as any;
  const input = toolUse.message.content[0].input;
  expect(input.file_path).toBe("src/app.ts");
  expect(input.old_string).toContain("const a = 1;");
  expect(input.new_string).toContain("const a = 2;");
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npm test -- lib/codex-parser.test.ts`
Expected: the new test FAILs (`file_path` undefined).

- [ ] **Step 3: Implement the patch parser + wire into remap**

In `lib/codex-parser.ts`, add:

```ts
/**
 * Minimal apply_patch parser. Codex emits a single hunk per file in the
 * `*** Begin Patch / *** Update File: <path>` format with -/+ lines.
 * Returns the first updated file's before/after text for the Edit renderer.
 * Multi-file patches: only the first file is surfaced (v1); the full patch
 * is preserved under _raw for the fallback.
 */
export function parseApplyPatch(patch: string): {
  file_path: string;
  old_string: string;
  new_string: string;
} | null {
  const lines = patch.split("\n");
  let file = "";
  const oldLines: string[] = [];
  const newLines: string[] = [];
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
```

Then in `remapToolInput`, replace the `apply_patch` case:

```ts
    case "apply_patch": {
      const raw = String(args["input"] ?? args["patch"] ?? "");
      const parsed = parseApplyPatch(raw);
      return parsed ? { ...parsed, _raw: raw } : { _raw: raw };
    }
```

- [ ] **Step 4: Run, expect pass**

Run: `npm test -- lib/codex-parser.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/codex-parser.ts lib/codex-parser.test.ts
git commit -m "feat(codex): parse apply_patch into Edit renderer input"
```

---

## Task 8: Codex loader — project grouping, listSessions, loadSession

**Files:**
- Create: `lib/codex-loader.ts`
- Modify: `lib/sources/index.ts` (replace `codexStub` with the real source)
- Test: `lib/codex-loader.test.ts`

Codex sessions are date-bucketed; projects are derived from `session_meta.cwd`. The rawId for a Codex "project" is a stable hash of the cwd. `loadSession` finds the rollout file whose filename contains the session uuid.

- [ ] **Step 1: Failing test (project grouping by cwd)**

Create `lib/codex-loader.test.ts`:

```ts
import { test, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { codexProjectId } from "./codex-loader";

test("codexProjectId is stable for a cwd", () => {
  expect(codexProjectId("/home/eric/proj")).toBe(codexProjectId("/home/eric/proj"));
  expect(codexProjectId("/home/eric/a")).not.toBe(codexProjectId("/home/eric/b"));
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npm test -- lib/codex-loader.test.ts`
Expected: FAIL — cannot find `./codex-loader`.

- [ ] **Step 3: Implement the loader**

Create `lib/codex-loader.ts`:

```ts
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

/** Read a rollout's head cheaply to get cwd + first user text + counts. */
async function summarizeRollout(filePath: string): Promise<RolloutInfo | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  const lines = (await readJsonl(filePath)) as Array<{
    timestamp?: string;
    type?: string;
    payload?: Record<string, unknown>;
  }>;
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
  const infos = await pMap(files, READ_CONCURRENCY, summarizeRollout);
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
  const lines = (await readJsonl(file)) as Parameters<typeof parseCodexRollout>[0];
  return parseCodexRollout(lines, sessionId);
}
```

- [ ] **Step 4: Run the grouping test, expect pass**

Run: `npm test -- lib/codex-loader.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Wire the real source into the registry**

In `lib/sources/index.ts`, delete `codexStub` and add:

```ts
import {
  listCodexProjects,
  listCodexSessions,
  loadCodexSession,
} from "../codex-loader";

const codexSource: SessionSource = {
  id: "codex",
  listProjects: listCodexProjects,
  listSessions: listCodexSessions,
  loadSession: loadCodexSession,
  listSubagents: async () => [],
};
```

Replace both `codexStub` references (`Promise.all` in `listProjects` and `sourceFor`) with `codexSource`.

- [ ] **Step 6: Integration smoke test against real Codex logs**

Run: `npm run build` then `node bin/cli.js --no-open --port 3841`.
Run: `curl -s localhost:3841/api/projects | python3 -m json.tool | grep -c '"codex"'`
Expected: ≥1 codex project. Pick a codex project id (starts with `codex:`), then:
`curl -s "localhost:3841/api/sessions/codex:<rawId>"` returns sessions, and
`curl -s "localhost:3841/api/session/codex:<rawId>/<sessionId>"` returns events with `tool_use`/`text` blocks. Kill the server.

- [ ] **Step 7: Commit**

```bash
git add lib/codex-loader.ts lib/codex-loader.test.ts lib/sources/index.ts
git commit -m "feat(codex): cwd-grouped projects, session listing + loading"
```

---

## Task 9: Search index — source tagging + `source:` operator

**Files:**
- Modify: `lib/search-index.ts`
- Modify: `lib/query-parser.ts`
- Test: `lib/query-parser.test.ts` (create if absent)

- [ ] **Step 1: Confirm the index builds from the source registry**

Run: `grep -n "listProjects\|listSessions\|loadSession\|from \"./session-loader\"" lib/search-index.ts`
Expected: it imports from `./session-loader`. Change that import to `./sources` so the index covers both sources:

```ts
import { listProjects, listSessions, loadSession } from "./sources";
```

- [ ] **Step 2: Carry `source` on each indexed session**

In `lib/search-index.ts`, the per-session index entry (the object that holds `decodedPath`, `gitBranch`, etc.) gains a `source` field set from the `SessionMeta.source` / `ProjectMeta.source` already available during the build loop. Find where the entry is constructed (`grep -n "decodedPath" lib/search-index.ts`) and add `source: project.source` (project meta is in scope as the loop variable).

- [ ] **Step 3: Add the `source` operator to the parser**

In `lib/query-parser.ts`, add `"source"` to `KNOWN_OPERATORS` and to the `Operator` union. No date/has validation needed; treat it like `project` (plain substring/exact). Add a `SOURCE_VALUES = ["claude", "codex"] as const` and validate in `validateToken` that `source:` is one of them (same pattern as the `has:` validation).

- [ ] **Step 4: Apply the filter in the index**

In `lib/search-index.ts` `applyFilters`, add a case:

```ts
      case "source":
        return entry.source === v; // v already lowercased
```

- [ ] **Step 5: Test the operator parse**

Create/append `lib/query-parser.test.ts`:

```ts
import { test, expect } from "vitest";
import { parseQuery } from "./query-parser";

test("source operator parses", () => {
  const q = parseQuery("source:codex exec");
  const t = q.filters.find((f) => f.key === "source");
  expect(t?.value).toBe("codex");
  expect(q.freeText).toBe("exec");
});
```

Run: `npm test -- lib/query-parser.test.ts`
Expected: pass.

- [ ] **Step 6: Build + commit**

Run: `npm run build`

```bash
git add lib/search-index.ts lib/query-parser.ts lib/query-parser.test.ts
git commit -m "feat(search): index both sources; add source: operator"
```

---

## Task 10: Source filter setting + toggle UI

**Files:**
- Modify: `lib/settings.ts`
- Create: `components/source-filter.tsx`
- Modify: `components/top-bar.tsx`
- Modify: `components/project-tree.tsx`
- Modify: `components/app-shell.tsx`

- [ ] **Step 1: Add the setting**

In `lib/settings.ts`: add `sourceFilter: "all" | "claude" | "codex"` to `Settings`, default `"all"` in `DEFAULT_SETTINGS`, and in `validateSettings` accept it only if it's one of those three (mirror the `theme` validation).

- [ ] **Step 2: Build the segmented control**

Create `components/source-filter.tsx`:

```tsx
"use client";

import { updateSettings, useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "all", label: "All" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
] as const;

export function SourceFilter() {
  const { sourceFilter } = useSettings();
  return (
    <div
      role="group"
      aria-label="Filter by source"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => updateSettings({ sourceFilter: o.value })}
          aria-pressed={sourceFilter === o.value}
          className={cn(
            "h-6 rounded px-2 text-[11px] font-medium transition-colors",
            sourceFilter === o.value
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Mount it in the top bar**

In `components/top-bar.tsx`, import `SourceFilter` and place it in the right-hand utility cluster (the `justify-end` flex `div`), before the settings gear:

```tsx
import { SourceFilter } from "./source-filter";
// ... inside the right cluster, first child:
<SourceFilter />
```

- [ ] **Step 4: Filter the project tree + add a badge**

In `components/project-tree.tsx`: read `const { sourceFilter } = useSettings();` (import `useSettings`), and filter the rendered projects: `projects.filter(p => sourceFilter === "all" || p.source === sourceFilter)`. For each project row, render a tiny badge when `sourceFilter === "all"`:

```tsx
<span className={cn(
  "rounded px-1 text-[9px] font-medium uppercase",
  project.source === "codex"
    ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
    : "bg-brand/15 text-brand",
)}>
  {project.source}
</span>
```

- [ ] **Step 5: Build + Playwright check**

Run: `npm run build`, restart server on the real data (`node bin/cli.js --no-open --port 3841`), open in Playwright. Verify: the All/Claude/Codex toggle appears; selecting Codex shows only codex projects (violet badge); selecting Claude hides them; the choice persists across reload (localStorage).

- [ ] **Step 6: Commit**

```bash
git add lib/settings.ts components/source-filter.tsx components/top-bar.tsx components/project-tree.tsx components/app-shell.tsx
git commit -m "feat(ui): All/Claude/Codex source toggle + project badges"
```

---

## Task 11: CLI `--source` support

**Files:**
- Modify: `bin/lib-query.js`
- Modify: `bin/cli-commands.js`

`bin/lib-query.js` is standalone plain Node (no Next runtime). It needs a Codex reader mirroring the web parser.

- [ ] **Step 1: Add Codex helpers to lib-query.js**

In `bin/lib-query.js`, add (plain CommonJS, mirroring `lib/codex-paths.ts` + the parser's message/tool extraction — translate the TS to JS):
- `codexSessionsRoot()` (honors `CCSV_CODEX_DIR`)
- `findRolloutFiles()` (recursive walk)
- `sessionIdFromRolloutPath(f)`
- `parseCodexRollout(lines, sessionId)` — same transform as `lib/codex-parser.ts`
- `listCodexProjects()` / `listCodexSessions(rawId)` / `loadCodexSession(sessionId)` — same as `lib/codex-loader.ts`, using a `sha1` cwd hash and a `codex:` prefix on returned project ids.

Mirror the existing JS style in the file. Each returned project/session object carries `source: "codex"`.

- [ ] **Step 2: Route by `--source` and prefix**

In `bin/lib-query.js`, change `listProjects`, `listSessions`, `loadSession`, `searchAll` to accept an options object with `source` (`"all" | "claude" | "codex"`, default `"all"`):
- `listProjects`: concat Claude (unprefixed) + Codex (`codex:` prefixed) per the filter.
- `listSessions(projectId, …)`: if `projectId` starts with `codex:`, strip and call the Codex path; else Claude.
- `loadSession(idOrPrefix, hint, …)`: if `hint`/match resolves to a `codex:` project or the uuid is found among rollout files, use the Codex loader.
- `searchAll(query, { source })`: include/exclude each source's sessions per the filter; reuse the existing scan over loaded events (Codex events are already normalized to the same shape, so the text/tool extraction is identical).

- [ ] **Step 3: Add the flag to cli-commands.js**

In `bin/cli-commands.js`, parse `--source <all|claude|codex>` from argv (default `all`) and thread it into the `lib-query` calls for `projects`, `sessions`, `show`, `search`, `stats`. Show the `source` in the human and `--json` output for each project/session row.

- [ ] **Step 4: Manual CLI checks**

Run:
```bash
node bin/cli.js projects --source codex
node bin/cli.js sessions "codex:<rawId>"
node bin/cli.js show "<codex-session-uuid>"
node bin/cli.js search "exec" --source codex
```
Expected: codex projects list; sessions list with source=codex; `show` renders the transcript with `[tool: exec_command] …` lines; search finds Codex text.

- [ ] **Step 5: Commit**

```bash
git add bin/lib-query.js bin/cli-commands.js
git commit -m "feat(cli): --source flag with Codex reader"
```

---

## Task 12: Mock fixtures + Playwright verification + regression

**Files:**
- Create: `/tmp/mock-codex/2026/06/02/rollout-2026-06-02T10-00-00-<uuid>.jsonl` (fixture)
- (No repo files; verification only)

- [ ] **Step 1: Write a Codex fixture**

Create `/tmp/mock-codex/2026/06/02/rollout-2026-06-02T10-00-00-aaaa1111-2222-3333-4444-555566667777.jsonl` with one line per event (envelope shape): a `session_meta` (cwd `/tmp/mock-codex-proj`), a user `message`, a `reasoning` (encrypted), an assistant `message`, an `exec_command` `function_call` + its `function_call_output`, a `meet_join`-style custom tool call + output, and one `apply_patch` call + output. (Use the shapes from `lib/codex-parser.test.ts`.)

- [ ] **Step 2: Launch on both mock dirs**

Run: `CCSV_PROJECTS_DIR=/tmp/mock-projects CCSV_CODEX_DIR=/tmp/mock-codex node bin/cli.js --no-open --port 3841`

- [ ] **Step 3: Playwright — Codex render**

Navigate to the app. With source=All, confirm both a Claude and a Codex project show with badges. Open the Codex session and confirm:
- user/assistant text render normally
- the reasoning block shows collapsed with the "(reasoning encrypted…)" placeholder
- `exec_command` renders as a Bash-style card titled `exec_command` with the command and its output
- the custom MCP tool renders via the fallback (name + JSON args + output)
- `apply_patch` renders as an Edit-style diff
Screenshot to `~/.playwright-mcp/` and read it back to confirm.

- [ ] **Step 4: Playwright — toggle + search**

Switch the toggle to Claude (codex project disappears), to Codex (only codex), back to All. Open ⌘K, search `source:codex exec`, confirm the Codex exec hit appears. Search `source:claude` confirms only Claude hits.

- [ ] **Step 5: Regression — Claude unchanged**

Open the existing Claude mock session; confirm it renders exactly as before (j/k nav, URL `?e=`, minimap, settings all still work).

- [ ] **Step 6: Final build + leak check + commit any fixes**

Run: `npm run build && node scripts/check-no-leaks.js && npm test`
Expected: build OK, leak check OK, all vitest pass.

```bash
git add -A
git commit -m "test(codex): mock fixtures + verified render/search/toggle parity"
```

---

## Self-Review Notes

- **Spec coverage:** parser (T5–7), source registry (T3), project grouping (T8), toggle (T10), CLI (T11), search `source:` (T9), tests (T0,12) — all spec sections mapped.
- **Tool mapping:** exec_command/write_stdin→Bash, apply_patch→Edit, rest→FALLBACK (T6 registry + T7 patch) matches spec.
- **Dedup / encrypted reasoning / developer-role:** handled in T5 per verified shapes.
- **Back-compat:** Claude project ids stay unprefixed (T3 decode treats unprefixed as claude) so existing URLs keep working — a refinement over the spec's "prefix both", noted here intentionally.
- **Type consistency:** `parseCodexRollout(lines, sessionId)`, `codexProjectId(cwd)`, `encodeProjectId/decodeProjectId`, `source` field — names consistent across tasks.
