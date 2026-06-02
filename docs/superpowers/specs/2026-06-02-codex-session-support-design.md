# Codex session support

**Status**: approved, ready for implementation plan
**Date**: 2026-06-02

Add OpenAI Codex CLI session logs as a second source alongside Claude
Code, with the same viewing experience (rendering, search, URL state,
keyboard nav, settings) and CLI coverage.

## Problem

The viewer only reads Claude Code's `~/.claude/projects/<encoded>/<uuid>.jsonl`
format. Codex writes a different format to `~/.codex/sessions/YYYY/MM/DD/
rollout-<ts>-<uuid>.jsonl`. We want Codex sessions to be first-class — not a
second-rate separate tool.

## Format differences (verified on real data, 44 sessions)

| | Claude Code | Codex |
|---|---|---|
| Path | `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` — project-bucketed | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` — date-bucketed, cwd inside `session_meta` |
| Line shape | event fields at top level | envelope `{timestamp, type, payload}` |
| Top-level type | `user` / `assistant` / `system` / … | `session_meta` / `response_item` / `event_msg` / `turn_context` |
| Message | `message.content[]` blocks | `response_item` payload.type=`message`, roles include `developer` |
| Tool call | `tool_use` block, `input` object, paired by `tool_use_id` | `function_call`, `arguments` JSON **string**, paired by `call_id`; result is `function_call_output` |
| Thinking | `thinking` block | `reasoning` response_item (sometimes `encrypted_content` only) |
| Duplication | none | same message appears in both `response_item` and `event_msg` |

Codex tools are MCP-style function calls. On real data, `exec_command`
dominates (622 calls); the rest are custom MCP tools (`meet_*`,
`spawn_agent`, `write_stdin`, calendar/docs tools).

## Approach

**Codex parser emits Claude-shaped `SessionEvent`** (normalize *into* the
existing type, not a new normalized model). Every existing renderer,
`search-index`, `conversation-view`, `minimap`, URL state, `j`/`k`, and
settings work unchanged. This directly delivers "same experience" and
"map to existing CC renderers" at the lowest cost and lowest regression
risk to the working Claude path.

Rejected alternatives:
- **True `NormalizedEvent` + refactor all renderers** — ~4 days, high
  regression risk on the working CC path, and the user wants CC-renderer
  reuse anyway.
- **Separate Codex renderers** — doubles UI code, contradicts the goal.

## Architecture

```
lib/sources/
  claude.ts   — wraps the existing session-loader logic
  codex.ts    — new: rollout JSONL → SessionEvent[]  (+ project/session listing)
  index.ts    — source registry; routes by project-id prefix, merges & filters
```

- `ProjectMeta` and `SessionMeta` gain `source: "claude" | "codex"`
  (additive — existing Claude path defaults to `"claude"`).
- Project ids are prefixed: `claude:<encoded>` / `codex:<cwd-hash>`. The
  existing `[projectId]` API routes keep their signatures; `sources/index.ts`
  dispatches on the prefix. Encode/decode helpers live in `sources/index.ts`.
- The existing `lib/session-loader.ts` becomes the implementation behind
  `sources/claude.ts` (moved, not rewritten). `claude-paths.ts` stays as-is.

### Source interface

Each source implements:

```ts
interface SessionSource {
  id: "claude" | "codex";
  listProjects(): Promise<ProjectMeta[]>;            // source-tagged
  listSessions(projectId: string): Promise<SessionMeta[]>;
  loadSession(projectId, sessionId): Promise<SessionEvent[]>;
  // subagents: claude only; codex returns [] for now
}
```

`sources/index.ts` exposes the same `listProjects/listSessions/loadSession`
the API layer already calls, fanning out to both sources and stripping the
prefix before delegating.

## Codex parser (`lib/sources/codex.ts`)

Pure transform per rollout file:

1. **Unwrap** each line's `{timestamp, type, payload}`.
2. **Dedup**: `response_item` (message) and `event_msg`
   (`agent_message` / `user_message`) carry the same content. Keep
   `response_item`; drop the `event_msg` duplicates. (Keep `token_count`
   for usage if cheap; otherwise ignore.)
3. **Pair** `function_call` ↔ `function_call_output` by `call_id`. Emit a
   synthetic assistant event with a `tool_use` block and a following user
   event with a `tool_result` block — mirroring Claude's shape so
   `buildToolMap` pairs them unchanged.
4. **Tool mapping** — register Codex names in the renderer REGISTRY pointing
   at existing renderers, and remap the input keys in the parser so the
   borrowed renderer's field expectations are met. The card title keeps the
   **real** Codex tool name; only the rendering is borrowed.
   - `exec_command` → Bash renderer (`{cmd}` → `{command}`); output from the
     paired `function_call_output.output`
   - `apply_patch` → Edit renderer (parse the `*** Begin Patch / *** Update
     File:` format into `{file_path, old_string, new_string}` and synthesize
     a `structuredPatch` so the diff-stat chips work). Basic version first;
     this user's current data has no `apply_patch`, so harden on real
     examples later.
   - `write_stdin` → Bash renderer
   - `meet_*` / `spawn_agent` / other MCP → FALLBACK renderer (already
     renders arbitrary JSON input + output well)
5. **reasoning** → `thinking` block. When only `encrypted_content` is
   present, emit a thinking block with a `(reasoning encrypted)` placeholder.
6. **session_meta** → `cwd` (for project grouping), session start time, and
   any title. `turn_context` → ignored for v1 (model/personality could feed
   metadata later).

`arguments` is a JSON string → `JSON.parse` with a try/catch; on failure,
pass the raw string through `defaultInputView`.

## Project grouping for Codex

Codex is date-bucketed, so projects don't exist as directories. Scan all
rollout files, read `session_meta.cwd`, group sessions by cwd. Each distinct
cwd becomes a `ProjectMeta` with `source: "codex"`. Use the existing 64 KB
"read the head of the file" trick to get cwd cheaply; cache by mtime+size
like the Claude path.

## Source toggle

A `All / Claude / Codex` control in the UI (top bar or sidebar header),
persisted in settings (`localStorage`, validated like the rest). Filters the
project tree and the search scope. Default `all`.

- `lib/settings.ts`: add `sourceFilter: "all" | "claude" | "codex"`.
- Project tree + `/api/projects` + search respect the filter. Simplest:
  the API returns all sources tagged; the client filters by
  `settings.sourceFilter`. Search passes the filter to the index.
- Each session row / project shows a small source badge so mixed lists stay
  legible (the user picked the toggle, but a badge still helps when "All").

## CLI

`bin/` subcommands (`projects`, `sessions`, `show`, `search`, `stats`, …)
gain `--source claude|codex|all` (default `all`). `bin/lib-query.js` (the
standalone pure-Node query layer) needs a Codex reader mirroring the web
parser — kept in plain Node, independent of the Next.js runtime, consistent
with how `lib-query.js` already duplicates the Claude logic.

## Search index

`search-index.ts` walks `SessionEvent` block shapes. Because Codex events
are normalized into the same shape, indexing works unchanged. The index
gains `source` per session so the `source:` filter (and the toggle) can
narrow results. Reuse the existing token-search operator machinery; add a
`source:` operator to the query parser.

## Testing

- Mock Codex rollout fixtures under `/tmp/mock-codex/` (envelope, message,
  exec_command + output, reasoning, encrypted reasoning, a custom MCP tool)
  plus an `apply_patch` example for the diff path.
- Parser unit checks: dedup, call_id pairing, input remap, patch parse.
- Playwright pass against the mock dir: render a Codex session, confirm
  exec_command shows as a Bash-style card with output, reasoning collapses
  like thinking, the source toggle filters, search finds Codex text, and the
  CLI `--source codex` lists/shows correctly.
- Regression: the existing Claude mock fixtures must still render identically.

## Out of scope (v1)

- Codex sub-agents as a navigable tree (Codex `spawn_agent` exists, but
  defer linking spawned-agent sessions; show the call inline via FALLBACK).
- `turn_context` model/personality surfacing.
- Live SSE for in-flight Codex sessions (the Claude SSE path can be wired
  later once the parser is proven).

## Effort

~4 half-days: parser + source routing (2), toggle UI + Codex project
grouping (1), CLI `--source` (0.5), tests (0.5).
