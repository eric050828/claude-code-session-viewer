---
name: ccsv
description: Query local Claude Code session logs via the `ccsv` CLI. Use when the user asks about past conversations, wants to find/recall a prior session, summarize what was discussed, or generate a report from session history. Operates on the read-only jsonl files under ~/.claude/projects/.
---

# Using `ccsv` to query Claude Code session history

`ccsv` is a local CLI that reads jsonl session logs under `~/.claude/projects/`.
It is **read-only** — no risk of corrupting history. Prefer it over manually
listing/reading jsonl files, which is slow and error-prone.

## When this skill applies

Activate when the user says or implies:

- "What did I work on yesterday / last week?"
- "Find the conversation where I [X]"
- "Summarise what we discussed about [topic]"
- "Generate a report of [feature work / token usage / time spent]"
- "What did Claude suggest about [X]?"
- "Pull the bash commands I ran in session [Y]"
- Any reference to a prior Claude Code session that isn't the current one.

If the user just wants to view sessions in a browser, point them at plain `ccsv`
(no subcommand) which launches the local web UI.

## Core mental model

- A **project** is a working directory the user ran Claude in. Identified by an
  `id` like `-home-user-foo` (encoded path) — note the encoding is lossy.
  Always prefer the `path` field for display.
- A **session** is one `claude code` invocation, stored as
  `<session-uuid>.jsonl`. Session IDs are UUIDs; partial 8-char prefixes work.
- A session has many **events**: `user` / `assistant` messages, `system` /
  `attachment` metadata, and Claude's `tool_use` calls plus the matching
  `tool_result`s.

## Command reference

All commands accept `--json` (machine-readable) and `-h` for usage. Use `--json`
whenever you plan to programmatically parse or transform output.

### `ccsv projects [--json]`
List projects, most recently active first. Use first when the user names a
directory and you need its `id`.

### `ccsv sessions [-p PROJ_ID] [-n N] [--json]`
List sessions, newest first. `-p` filters to one project. `-n` caps results.

### `ccsv show <id> [-f transcript|json|raw] [-n N] [--thinking]`
Print one session.
- `-f transcript` (default): human-readable user/assistant turns with compact
  tool-call lines. Best for reading or summarising.
- `-f raw`: original jsonl, one event per line. Best for grep / jq pipelines.
- `-f json`: pretty-printed JSON with metadata. Best when you want the file
  paths and timestamps in one structured blob.
- `-n N`: only the last N events (combine with raw/json for tailing).
- `--thinking`: include Claude's internal reasoning blocks in the transcript.

### `ccsv tail <id> [-n 20] [--json]`
Last N user/assistant messages of a session. Cheap; great when the user wants
"what happened most recently in session X".

### `ccsv search <query> [-n 30] [-p PROJ_ID] [--json]`
Substring search (case-insensitive) over message text, thinking blocks, tool
inputs, and tool results across every session. Returns hits with `sessionId`,
`matchType`, and an excerpt.

### `ccsv stats [-p PROJ_ID] [--json]`
Aggregate counts: sessions, messages, tool uses, token usage broken down by
kind, and the top 10 tool names.

## Common workflows

### Find a past conversation

```
$ ccsv search "Stripe webhook" -n 10
```

Then read the most relevant one:

```
$ ccsv show <session-id-prefix> -f transcript | less
```

### Build a report on what the user did in a project this week

```
$ ccsv sessions -p <proj-id> --json \
  | jq '[.[] | select(.lastTimestamp > "2026-05-04")]'
```

Then loop over the result and pull transcripts with `ccsv show <id>` to
synthesise a summary.

### Recover a bash command the user ran in a prior session

```
$ ccsv search "your search term" --json | jq '.[0]'
$ ccsv show <id> -f raw | jq -c 'select(.message?.content[]?.name=="Bash")'
```

### Tail an in-progress session

`ccsv tail <id>` is safe to run repeatedly — no daemon, no locking.

## Tips & gotchas

- **Session IDs are unique across all projects**, so `-p` is optional for
  `show` / `tail`. Use it as a hint only if your prefix is ambiguous; the CLI
  will error with the candidates if it is.
- **Project paths are best-effort decoded** from the encoded directory name
  (`/` and `_` both map to `-`, lossy). The CLI re-reads `cwd` from a real
  event when possible — trust the `path` field, not the `id`.
- **`-f transcript` summarises tool calls compactly**: `[tool: Bash] <cmd>`
  rather than dumping JSON. Use `-f raw` if you need full tool inputs/results.
- **The current session is included.** When the user says "the previous
  session", you may need to skip the most-recent one (which is *this* one)
  and pick the next.
- **Be conservative with `--limit` defaults**: `ccsv show` without `-n` prints
  the whole session; large sessions can be tens of thousands of lines. Pipe
  through `head`, `wc -l`, or use `tail` first to gauge size.
- **Pipe `--json` into `jq`** rather than parsing the human-readable output —
  the human format is for display only and may change.

## What `ccsv` does *not* do

- It does not modify any file under `~/.claude/`.
- It does not call the Anthropic API. All data is local jsonl on disk.
- It cannot start, resume, or stop a Claude Code session — only read history.
- There is no "summarise this session" command built in — use `ccsv show -f
  transcript` and synthesise the summary yourself.
