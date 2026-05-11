# Claude Code Session Viewer (ccsv)

Local web UI for browsing your `~/.claude/projects/` session logs.

- All projects · all sessions · all messages
- Tool uses, sub-agents, thinking, system events, hook attachments — every Claude Code event type
- Edit/Write tools render as **diffs**, Bash as terminal output, Read shows file path + range, Task drills into the sub-agent thread
- Global ⌘K search (text / thinking / tool input / tool result / titles) + in-session ⌘F highlight
- Live updates: while a session is running in another terminal, new messages stream in via SSE

## Install (local)

```bash
git clone <this-repo> ~/claude-code-session-viewer
cd ~/claude-code-session-viewer
npm install
npm link        # registers `ccsv` and `claude-code-session-viewer` as global commands
```

Then anywhere:

```bash
ccsv            # builds on first run, opens http://localhost:3838
```

Or via npx without installing:

```bash
cd ~/claude-code-session-viewer
npx . 
```

## Usage

```
ccsv [options]              start the web viewer

  --port <n>     preferred port (default 3838; auto-falls-through if taken)
  --no-open      don't auto-open the browser
  --build        force rebuild before starting
  --dev          run `next dev` (hot reload; for hacking on the viewer itself)
  -h, --help
```

Override projects directory: `CCSV_PROJECTS_DIR=/some/other/path ccsv`

### CLI subcommands (no web server needed)

```
ccsv projects                        list all projects
ccsv sessions [-p PROJ_ID] [-n N]    list sessions
ccsv show <id> [-f transcript|json|raw] [-n N] [--thinking]
ccsv tail <id> [-n 20]               last N user/assistant messages
ccsv search <query> [-n 30]          substring search across all sessions
ccsv stats [-p PROJ_ID]              tokens / tool / message counts
```

All commands accept `--json` for machine output. Session IDs accept any unique
prefix (8 chars usually enough).

```bash
ccsv search "stripe webhook" --json | jq '.[0]'
ccsv show <session-prefix> -f transcript | less
ccsv stats -p <project-id>     # get IDs from `ccsv projects`
```

## Skill for Claude

There's a skill in `skills/ccsv/` that teaches other Claude instances when and
how to use the CLI (e.g. "find the session where I discussed X" or "summarise
last week's work"). Install it for Claude Code by symlinking into your skills
directory:

```bash
mkdir -p ~/.claude/skills
ln -s "$(npm root -g)/claude-code-session-viewer/skills/ccsv" ~/.claude/skills/ccsv
# or, if installed locally:
# ln -s <path-to-repo>/skills/ccsv ~/.claude/skills/ccsv
```

Once installed, Claude will pick it up automatically when you ask about prior
sessions and use the CLI to answer.

## Keyboard

- `⌘K` / `Ctrl-K` — global search
- `⌘F` / `Ctrl-F` — find in current session
- `Esc` — close dialog / detail pane
- click `Maximize2` icon on any tool card to push it into the right detail pane

## Notes

- The viewer is read-only. It never writes to `~/.claude/`.
- First launch builds a fuse.js search index in memory; rebuild auto-triggers when project mtimes change (TTL 30s).
- Live update uses 1.5s file polling; lightweight enough to leave open all day.
