# Changelog

All notable changes to this project will be documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] — 2026-05-24

### Added

- **Recent activity** empty state. When no session is selected, the
  conversation pane lists the 12 most recently modified sessions across
  all projects, sorted by `lastTimestamp` desc. Each item shows the
  project path, git branch, message/tool counts, sub-agent badge, an
  active-session indicator, and relative time. Same Cmd-click /
  middle-click opens-in-new-tab semantics as the sidebar list.
- **`GET /api/recent`** endpoint backing the empty state.

## [0.2.0] — 2026-05-21

### Added

- **GitLab-style token search** in the global ⌘K dialog and the sidebar
  filter. Operators: `id:`, `project:`, `branch:`, `tool:`, `model:`,
  `has:` (subagents / thinking / errors / active), `type:` (user /
  assistant / thinking / tool_input / tool_result / title), `before:`
  and `after:` (ISO date or relative — `7d` / `today` / `yesterday`),
  with `-` negation and `"quoted values"`. Free text mixes freely with
  tokens. Unknown operators fall back to literal substring so typos
  don't return zero results. Autocomplete dropdown shows operators on
  focus, then values + counts as you type. The same `QueryInput` powers
  both the dialog and the sidebar; sidebar silently hides `project:`
  since it's already scoped.
- **URL state** — project, session, search query, and the user message
  currently in view are all reflected in the URL (`?p=&s=&q=&e=`). The
  browser back button restores recently viewed sessions; reload keeps
  you where you were; deep links work.
- **Active message tracking** — as you scroll, `?e=<uuid>` auto-updates
  via cached `offsetTop` + binary search (O(log N) per scroll, no
  per-frame layout reads, survives Cmd+End jumps that an
  IntersectionObserver would miss).
- **`j`/`k` keyboard navigation** between user messages, with smooth
  scroll + flash. Explicit nav pushes history so back steps through
  the messages you jumped to; passive scroll uses `replaceState` so
  the URL stays current without polluting history.
- **Settings modal** (gear icon in the top bar, or `⌘,`) with theme
  (light / dark / system), full keyboard shortcut customization
  (each shortcut individually rebindable; key capture mode in the UI;
  reset per row or for all), and display toggles (show minimap,
  auto-expand thinking blocks, live updates, auto-scroll to bottom on
  session open). Persisted in `localStorage` with shape validation.
- **Sidebar collapse** (button anchored to the panel's edge, plus
  `⌘B` shortcut). Notion-style: toggle sits inside the sidebar
  header when expanded, and moves to the session header's left edge
  when collapsed — always reachable.
- **Background task output** rendered inline. Bash and Task tool
  cards that show `Command running in background with ID: …` now
  expand to show the `.output` file contents directly, with reload +
  copy.
- **Sub-agent responses rendered as markdown** in the detail pane.

### Changed

- Search dropdown opens on focus instead of waiting for the first
  keystroke — discoverable filters from the start. Closes on Esc /
  blur / pick.
- `j`/`k` direction default is positional (j = up, k = down). Vim
  convention available via the shortcut editor or by swapping the
  `nav.prev` / `nav.next` bindings.
- Top-bar search box recentered (3-column grid) and widened to
  `40rem`. Sidebar toggle moved out of the top bar onto the panel's
  edge so the bar stays uncluttered.
- Light mode contrast fixes on diff text, role labels, tinted chips,
  and `highlight.js` code blocks (was inheriting hljs's dark theme
  globally — switched to in-app GitHub Light / Dark token sets).
- Settings toggle knob alignment corrected (was off-center because of
  implicit absolute positioning).

### Fixed

- **Path traversal in `/api/task-output`**: the regex accepted `..`
  as a path segment, so a crafted URL could resolve to another user's
  task-output file on a shared host. Now requires the path to equal
  its normalized form before any filesystem access.
- **CSS selector injection** via `?e=`: `querySelector` calls on
  attacker-controlled uuids now go through `CSS.escape()`.
- **Settings JSON deserialization** validates field types instead of
  spreading whatever's in `localStorage`.
- Sidebar autocomplete dropdown no longer pops on every page load
  before the user focuses it.
- Many Vercel Web Interface Guidelines compliance fixes: invalid
  nested button in the background-output header (now flex div with
  sibling buttons), session and search-result rows switched from
  `<button>` to `<a href>` so Cmd-click opens in a new tab, kbd hint
  pairs glued with `whitespace-nowrap`, top-bar `⌘ K` uses NBSP,
  input wrappers gained `focus-within` ring, settings dialog scroll
  region gained `overscroll-contain`.

## [0.1.1] — 2026-05-11

### Notes

Republished the initial feature set under a new version because the previous
`0.1.0` was permanently reserved on npm after an earlier unpublish. No code
changes vs. the unreleased `0.1.0` from the same day — see that section below
for the full feature inventory.

### Changed

- README: install/usage rewritten for the npm-published flow
  (`npm install -g` / `npx`).
- `scripts/check-no-leaks.js`: company tokens + non-public-provider email
  pattern added; vendored `.next/standalone/node_modules/` excluded from the
  email sweep (third-party maintainer emails aren't leaks).

## [0.1.0] — Initial release

### Added

- **Web viewer** for `~/.claude/projects/`: project tree, session list,
  conversation thread, slide-in detail pane.
- **Per-tool renderers**: Bash (terminal), Edit/MultiEdit (line diff),
  Read/Write (file path + content), Grep/Glob (file lists + duration),
  Task/Agent (sub-agent stats and recursive drill-down), WebFetch/WebSearch
  (response code + size + duration), TodoWrite (checklist), thinking blocks,
  hook attachments, every meta event type behind a "Meta" toggle.
- **Token usage**: per-message badges and session-wide aggregate in the
  header. `stop_reason` chip for `tool_use`/`max_tokens` turns.
- **`turn_duration` boundary markers** rendered as horizontal separators.
- **Global ⌘K search** across all sessions (text, thinking, tool input/
  result, titles) with in-memory index + persistent disk cache; in-session
  ⌘F highlight with prev/next.
- **Conversation minimap** on the right edge: dot per user message, viewport
  indicator, click-to-jump, hover preview.
- **Live updates** for in-flight sessions via SSE polling.
- **Light / dark / system theme** toggle in the top bar, persisted in
  `localStorage`, FOUC-safe via inline init script.
- **Copy-on-hover** affordances on every inspectable value (file paths,
  commands, diff old/new, tool input/result, message bodies, thinking,
  session IDs, branches, cwd).
- **Auto-scroll to bottom** when opening a session.

### CLI

- `ccsv` (no args) starts the web viewer on `http://localhost:3838`.
- `ccsv projects` / `sessions` / `show` / `tail` / `search` / `stats`
  subcommands operate without the server, all support `--json`.
- Bundled in `skills/ccsv/SKILL.md` so other Claude instances can use the
  CLI to find / summarise prior conversations.

### Privacy & build hygiene

- `scripts/scrub-build.js` (runs as part of `npm run build`) replaces the
  builder's absolute path in `.next/standalone/` with `/__BUILD_ROOT__`.
- `scripts/check-no-leaks.js` (runs from `prepublishOnly`) fails the publish
  if any `/home/<user>/...` or `/Users/<user>/...` paths slip into the
  tarball.

### Accessibility

- All icon-only buttons labelled (`aria-label`), decorative icons hidden
  (`aria-hidden`).
- Collapsibles use `aria-expanded`; theme toggle uses `aria-pressed`.
- Global `:focus-visible` ring; inputs labelled with `aria-label` and
  `autoComplete="off"` / `spellCheck={false}`.
- Global `prefers-reduced-motion` honoured; animations use `motion-safe:`.
- `content-visibility: auto` virtualises long conversations.
- Skip-to-content link and proper `<h1>`/`<h2>` heading hierarchy.
- Light-mode contrast adjusted on coloured chips and text.
- `translate="no"` on identifiers (session IDs, tool names, paths) to stop
  browser auto-translation from mangling them.

[Unreleased]: https://github.com/eric050828/claude-code-session-viewer/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/eric050828/claude-code-session-viewer/releases/tag/v0.1.1
[0.1.0]: https://github.com/eric050828/claude-code-session-viewer/releases/tag/v0.1.0
