# Claude Code Session Viewer (ccsv)

Local web UI **and** CLI for browsing your `~/.claude/projects/` session logs.
Read-only — never writes to `~/.claude/`.

- All projects · all sessions · all messages, including thinking, tool uses, sub-agents, hook attachments, and every other Claude Code event type
- Edit/Write tools render as **diffs**, Bash as terminal output, Read shows file path + range, Task drills into the sub-agent thread
- Token usage per message + session totals, `turn_duration` boundary markers
- Global ⌘K search (text / thinking / tool input / tool result / titles) + in-session ⌘F highlight
- Conversation minimap on the right edge with click-to-jump
- Live SSE updates while a session is running in another terminal
- Light / dark / system theme toggle
- A bundled `skills/ccsv` skill teaches other Claude instances how to query session history through the CLI

## Install

```bash
# global install — adds `ccsv` and `claude-code-session-viewer` to PATH
npm install -g claude-code-session-viewer
```

Or run it once without installing:

```bash
npx claude-code-session-viewer
```

Requires Node.js ≥ 18.17.

## Usage

```bash
ccsv                # start the web viewer at http://localhost:3838
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

Override the projects directory: `CCSV_PROJECTS_DIR=/some/other/path ccsv`

### CLI subcommands (no web server needed)

```
ccsv projects                          list all projects
ccsv sessions [-p PROJ_ID] [-n N]      list sessions
ccsv show <id> [-f transcript|json|raw] [-n N] [--thinking]
ccsv tail <id> [-n 20]                 last N user/assistant messages
ccsv search <query> [-n 30]            substring search across all sessions
ccsv stats [-p PROJ_ID]                tokens / tool / message counts
```

All commands accept `--json` for machine output. Session IDs accept any unique
prefix (8 chars is usually enough).

```bash
ccsv search "stripe webhook" --json | jq '.[0]'
ccsv show <session-prefix> -f transcript | less
ccsv stats -p <project-id>             # IDs from `ccsv projects`
```

### Skill for Claude

The bundled skill at `skills/ccsv/` teaches other Claude instances when and
how to use the CLI ("find the session where I discussed X", "summarise last
week's work"). Install it for Claude Code with one symlink:

```bash
mkdir -p ~/.claude/skills
ln -s "$(npm root -g)/claude-code-session-viewer/skills/ccsv" ~/.claude/skills/ccsv
```

Claude Code picks it up automatically; the next time you ask about prior
sessions, it will reach for `ccsv` instead of grepping jsonl by hand.

## Keyboard

- `⌘K` / `Ctrl-K` — global search
- `⌘F` / `Ctrl-F` — find in current session
- `Esc` — close dialog / detail pane
- Click the maximize icon on any tool card to push it into the right detail pane

## Hacking on it

```bash
git clone https://github.com/eric050828/claude-code-session-viewer.git
cd claude-code-session-viewer
npm install
npm run dev                       # hot reload at http://localhost:3838

# or run the CLI from source
node bin/cli.js projects
```

Releasing: see [RELEASING.md](RELEASING.md).
Changes per version: see [CHANGELOG.md](CHANGELOG.md).

## Notes

- Read-only with respect to `~/.claude/`. The only thing the viewer writes is
  a metadata cache under `~/.cache/claude-code-session-viewer/` (per-file
  parse results keyed by `mtime+size`, deleted freely without consequence).
- First launch builds a fuse.js search index in memory; subsequent rebuilds
  only re-parse files whose `mtime+size` changed (TTL 30s).
- Live update uses ~1.5s file polling via SSE — lightweight enough to leave
  open all day.

## License

[MIT](LICENSE)
