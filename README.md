<div align="center">

# Claude Code Session Viewer

**Browse your Claude Code history.** Local web viewer **and** CLI for
`~/.claude/projects/` — read-only, never writes to your `~/.claude`.

[![npm](https://img.shields.io/npm/v/claude-code-session-viewer.svg?color=D97757&style=flat-square)](https://www.npmjs.com/package/claude-code-session-viewer)
[![downloads](https://img.shields.io/npm/dm/claude-code-session-viewer.svg?style=flat-square)](https://www.npmjs.com/package/claude-code-session-viewer)
[![CI](https://img.shields.io/github/actions/workflow/status/eric050828/claude-code-session-viewer/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/eric050828/claude-code-session-viewer/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/claude-code-session-viewer.svg?style=flat-square)](LICENSE)
[![node](https://img.shields.io/node/v/claude-code-session-viewer.svg?style=flat-square)](package.json)

[Install](#install)&nbsp;·&nbsp;[Why](#why-ccsv)&nbsp;·&nbsp;[Features](#features)&nbsp;·&nbsp;[Architecture](#architecture)&nbsp;·&nbsp;[CLI](#cli)&nbsp;·&nbsp;[Skill](#skill-for-claude)&nbsp;·&nbsp;[Hacking](#hacking-on-it)

<br>

<img alt="Dark mode screenshot of ccsv" src="https://raw.githubusercontent.com/eric050828/claude-code-session-viewer/main/docs/screenshot-dark.png" width="900">

</div>

---

## Install

```bash
# global install — adds `ccsv` and `claude-code-session-viewer` to PATH
npm install -g claude-code-session-viewer
```

Or run once without installing:

```bash
npx claude-code-session-viewer
```

Requires Node.js ≥ 18.17.

## Why ccsv?

You already have all the data: every conversation lives in `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`. The question is what to do with it.

| Task | Without ccsv | With ccsv |
| --- | --- | --- |
| Find a past conversation about X | `grep -r "X" ~/.claude/projects/` then squint at line numbers | `ccsv search X` returns sessionId + excerpts (or `⌘K` in the UI) |
| Read a session | `cat …jsonl \| jq -c 'select(.type=="user")'` | `ccsv show <8-char-prefix>` — formatted transcript |
| Diff what Claude edited | parse `tool_use` → `Edit` → reconstruct from `old_string`/`new_string` | line-by-line diff in the UI, automatic from `structuredPatch` |
| Token cost per session | sum `message.usage.*` by hand | session header + per-message badges, or `ccsv stats` |
| Drill into a sub-agent | open the sub-agent's separate `.jsonl` | click "Sub-agent" on the Task tool card; opens inline |
| Find which session ran a Bash command | grep through every file | `ccsv search "<cmd>" --json \| jq` |
| Get an LLM to summarize a session | manually copy/paste excerpts | `ccsv show <id> -f transcript` for a clean transcript, or the bundled `skills/ccsv` skill teaches Claude how to do it |

It's the same data — ccsv just refuses to make you read jsonl by hand.

## Features

| | |
| --- | --- |
| **Web UI** | 3-pane layout: projects + sessions (left), conversation (centre), slide-in detail pane (right). Conversation minimap on the far right with click-to-jump. |
| **Per-tool renderers** | Bash → terminal · Edit/MultiEdit → diff · Read/Write → file view · Grep/Glob → file list + duration · Task → sub-agent stats + recursive drill-in · WebFetch/WebSearch → response code, size, results · TodoWrite → checklist · thinking blocks · hook attachments |
| **Token tracking** | Per-message badges (input ↓ / output ↑ / cache) and session-wide totals in the header. `stop_reason` chip for `tool_use` / `max_tokens` turns; `turn_duration` boundary markers between turns. |
| **Search** | Global ⌘K substring across text / thinking / tool input / tool result / titles, with fuse.js fuzzy fallback on titles. In-session ⌘F highlight + prev/next. Cached on disk for re-launch speed. |
| **Live updates** | SSE polling for in-flight sessions — open it while Claude is running and new messages appear as they happen. |
| **Theme toggle** | Light / dark / system in the top bar. FOUC-safe inline init. |
| **Copy-on-hover** | Every file path, command, diff (old + new), tool input/result, message body, thinking block, session ID. |
| **Auto-scroll** | Lands on the most recent message when you open a session. |
| **CLI** | `projects` / `sessions` / `show` / `tail` / `search` / `stats` — all support `--json`. No server required for query operations. |
| **Bundled skill** | `skills/ccsv/SKILL.md` teaches other Claude instances when and how to use the CLI for "find the session where I discussed X" type tasks. |
| **Privacy hygiene** | Pre-publish leak guard, post-build path scrubber. `translate="no"` on identifiers so Chrome auto-translate doesn't mangle session IDs and tool names. |
| **Accessibility** | WAI-compliant: aria-labels, focus-visible rings, `prefers-reduced-motion`, `content-visibility` virtualization for long sessions, light-mode contrast pass. |

<details>
<summary><strong>Light mode screenshot</strong></summary>

<img alt="Light mode screenshot" src="https://raw.githubusercontent.com/eric050828/claude-code-session-viewer/main/docs/screenshot-light.png" width="900">

</details>

<details>
<summary><strong>Global ⌘K search dialog</strong></summary>

<img alt="Search dialog screenshot" src="https://raw.githubusercontent.com/eric050828/claude-code-session-viewer/main/docs/screenshot-search.png" width="900">

</details>

## Architecture

```mermaid
flowchart LR
  jsonl[<code>~/.claude/projects/</code><br/><b>*.jsonl</b>]
  parser[Streaming<br/>jsonl parser]
  cache[(<code>~/.cache/ccsv/</code><br/>session-meta + search items)]
  idx[(In-memory<br/>fuse.js index)]
  api[Next.js<br/>API routes]
  sse[SSE stream]
  ui[Web UI<br/>React]
  cli[CLI subcommands<br/>pure Node]

  jsonl -- mtime+size keyed --> parser
  parser --> cache
  parser --> idx
  cache --> api
  idx --> api
  jsonl -. fs.watch .-> sse
  api --> ui
  sse --> ui
  jsonl --> cli

  classDef store fill:#27272a,stroke:#52525b,color:#fafafa;
  classDef compute fill:#D97757,stroke:#D97757,color:#fff;
  classDef io fill:#7DD3FC,stroke:#0284c7,color:#082f49;
  class jsonl,cache,idx store;
  class parser,api,sse compute;
  class ui,cli io;
```

The same parser feeds the web server and the CLI. Disk cache means warm starts read no jsonl at all unless a file's `mtime+size` changed.

## Web UI

```bash
ccsv                # start the viewer at http://localhost:3838
```

Options:

```
ccsv [options]
  --port <n>     preferred port (default 3838; auto-fall-through if taken)
  --no-open      don't auto-open the browser
  --build        force rebuild before starting
  --dev          run `next dev` (only useful when hacking on the viewer itself)
  -h, --help
```

### Keyboard

| Key | Action |
| --- | --- |
| `⌘ K` / `Ctrl K` | Global search dialog |
| `⌘ F` / `Ctrl F` | Find in current session |
| `Esc` | Close dialog / detail pane / find bar |
| Click *maximize* on any tool card | Push it into the right detail pane |

## CLI

All subcommands accept `--json` for machine output. Session IDs accept any unique prefix (8 chars is usually enough).

```
ccsv projects                          list all projects
ccsv sessions [-p PROJ_ID] [-n N]      list sessions
ccsv show <id> [-f transcript|json|raw] [-n N] [--thinking]
ccsv tail <id> [-n 20]                 last N user/assistant messages
ccsv search <query> [-n 30]            substring search across all sessions
ccsv stats [-p PROJ_ID]                tokens / tool / message counts
```

### Examples

```bash
# find the conversation where you talked about Stripe webhooks
ccsv search "stripe webhook" --json | jq '.[0]'

# read it as a clean transcript
ccsv show <session-prefix> -f transcript | less

# tally how much you've burned in tokens on a project this week
ccsv stats -p <project-id> --json | jq '.usage'

# tail an in-flight session — safe to spam
watch -n 2 'ccsv tail <session-prefix> -n 10'
```

Override the projects directory: `CCSV_PROJECTS_DIR=/some/other/path ccsv`.

## Skill for Claude

The bundled skill at `skills/ccsv/` teaches other Claude instances when and how
to use the CLI ("find the session where I discussed X", "summarise last
week's work"). Install it for Claude Code with one symlink:

```bash
mkdir -p ~/.claude/skills
ln -s "$(npm root -g)/claude-code-session-viewer/skills/ccsv" ~/.claude/skills/ccsv
```

Claude Code picks it up automatically; the next time you ask about prior
sessions, it will reach for `ccsv` instead of grepping jsonl by hand.

## Hacking on it

```bash
git clone https://github.com/eric050828/claude-code-session-viewer.git
cd claude-code-session-viewer
npm install
npm run dev                       # hot reload at http://localhost:3838

# or run the CLI from source
node bin/cli.js projects
```

| Want to | See |
| --- | --- |
| Cut a release | [RELEASING.md](RELEASING.md) |
| Read what changed | [CHANGELOG.md](CHANGELOG.md) |
| Understand what's read-only / safe | [Notes](#notes) below |

## Notes

- **Read-only** with respect to `~/.claude/`. The only thing ccsv writes is a
  metadata cache under `~/.cache/claude-code-session-viewer/` (per-file parse
  results keyed by `mtime+size`, deletable without consequence).
- First launch builds a search index in memory; subsequent rebuilds only
  re-parse files whose `mtime+size` changed (TTL 30s).
- Live update uses ~1.5s file polling via SSE — lightweight enough to leave
  open all day.
- Build artifacts ship pre-scrubbed: `scripts/scrub-build.js` replaces the
  builder's absolute path with `/__BUILD_ROOT__` so no developer's home dir
  leaks into the published tarball. CI's `prepublishOnly` will fail the
  publish if anything slips through.

## License

[MIT](LICENSE)
