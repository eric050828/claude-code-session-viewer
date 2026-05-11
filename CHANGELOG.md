# Changelog

All notable changes to this project will be documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
