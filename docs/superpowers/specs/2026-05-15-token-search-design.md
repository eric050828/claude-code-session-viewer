# Token-based search for ccsv

**Status**: approved, in implementation
**Date**: 2026-05-15
**Replaces**: the substring + title-fuzzy search in
`lib/search-index.ts` and `components/session-list.tsx`'s plain-text filter.

## Problem

Three usability gaps in the current search:

1. **No session ID lookup**. A user with a UUID (from a log, a screenshot, a
   colleague) cannot paste it and jump straight to that session — global
   search matches text but not session IDs, and sidebar filter only sees the
   current project.
2. **Flat search results**. Substring match across every field with no way
   to say "I only care about tool inputs", "show me sessions on `main`", or
   "only the past week".
3. **Sidebar filter is project-scoped**. Useful for narrowing within a
   project but disconnected from the global search; users have to learn
   two different interaction patterns.

## Goals

- Look up a session by full UUID **or** any unique prefix (8 chars typical).
- One query language, used in both global search and sidebar filter.
- Type-by-type filtering (per-field, per-attribute), composable with free
  text, in the style of GitLab issue search.
- Keep "just type a word" working as before; structured tokens are opt-in.
- Stay snappy: parser runs on every keystroke; result panel updates inside
  the existing debounced search pipeline.

## Non-goals

- Boolean grouping (`(a OR b) AND c`). All tokens are AND-ed; OR is rare in
  practice and complicates parsing.
- Saved searches / pinned queries. Defer.
- Faceted sidebar (checkbox filter panel). Defer; the query string is
  already the URL-shareable state.
- Regex/glob in operator values. Defer.

## Query grammar

```
query   = (token | freeText | quoted)*
token   = (negation)? key ':' value
key     = [a-z]+
value   = unquoted | quoted
unquoted= [^\s"]+
quoted  = '"' [^"]* '"'
negation= '-'
freeText= any non-token word, AND-ed with other free text into a substring match
```

Examples:

```
id:fb44f1ef                                # by ID prefix
tool:Bash signature                        # used Bash AND text contains "signature"
branch:"feat/cors-debug" -tool:Read        # branch with space, NOT using Read
after:2026-05-01 has:subagents             # date + flag
project:adk type:thinking compaction       # project + match-type + free text
```

## Operator set (v1)

| Operator | Match against | Example values |
|---|---|---|
| `id:<v>` | session UUID (full or prefix, case-insensitive) | `fb44`, `fb44f1ef-7b9e` |
| `project:<v>` | `decodedPath` substring | `adk`, `home/user/foo` |
| `branch:<v>` | git branch substring | `main`, `feat/cors` |
| `tool:<v>` | tool name (exact, case-sensitive) | `Bash`, `Edit`, `Task` |
| `model:<v>` | assistant model substring | `opus`, `sonnet` |
| `has:<flag>` | session flag, one of: `subagents` `thinking` `errors` `active` (active = mtime within 5 min) | `has:subagents` |
| `type:<kind>` | restrict match-type, one of: `user` `assistant` `thinking` `tool_input` `tool_result` `title` | `type:thinking` |
| `before:<d>` `after:<d>` | last activity timestamp; date is ISO (`2026-05-04`), or relative (`today`, `yesterday`, `7d`, `3w`, `1m`) | `after:7d` |
| `-token` | invert any of the above | `-tool:Read` |

Unknown operator → fall back to substring search of the literal string
`key:value` (so a user typing `note:foo` doesn't see "no results"); the
parsed-preview row marks it `unknown` in muted color.

## UI

### Input

- Plain `<input>` (no chip-input library). Parse on every keystroke.
- Inline highlight: operator keys get a brand-tinted background, values
  remain regular text, free text shows as muted italic.
- Right side of the input: the existing `⌘ K` / `Esc` kbd hint.

### Parsed-preview row

A second row directly under the input, scrolls horizontally if many
tokens. Each parsed token is a small read-only chip:

- Chip text: `id:fb44` (key + value, monospace).
- Negated tokens (`-tool:Read`) render with a strikethrough and a `−` glyph.
- Date tokens show the resolved absolute date in a `title` tooltip
  (`after:7d` → tooltip "2026-05-08").
- Each chip has an `×` button. Clicking it slices that range out of the
  input.
- Free text is shown as one chip labeled `free: <words>`.
- Errors (`before:not-a-date`) render red with a warning icon and a
  tooltip describing the problem.
- A "Clear all" button at the row's right edge.

### Autocomplete dropdown

Triggers on:

- A new word boundary in the input (cursor lands after whitespace at end).
- Typing `:` after a known operator key.

Content per phase:

- **Operator menu**: list of all keys with one-line descriptions, filtered
  by what's typed.
- **Value menu** (after `:`):
  - `tool:` — top tools by usage count, with counts.
  - `branch:` — distinct branches in the indexed sessions.
  - `model:` — distinct models.
  - `has:` — fixed list (`subagents`, `thinking`, `errors`, `active`).
  - `type:` — fixed list of match types.
  - `before:` / `after:` — common shorthand list (`today`, `yesterday`,
    `7d`, `30d`) plus a hint line `YYYY-MM-DD also works`.
  - `id:` / `project:` — no completions (free-form prefix); show a small
    hint instead.

Keyboard: `↑↓` move, `Enter` / `Tab` complete, `Esc` close, typing past
the suggestion ignores it.

### Result list

- Existing rendering, plus a `via <token>` chip on each row when the match
  came from a token filter (not free text). Helps the user understand
  *why* a session showed up.
- `aria-live="polite"` on the result count.
- Empty state offers a "remove last filter" suggestion when a filter is
  active.

### Sidebar filter

Same component as global, compact variant (no kbd hint, no result panel —
it filters the visible session list in place). `project:` is silently
ignored because the sidebar is already scoped to the active project.

## Data flow

```
input string
   ↓ (debounced 150ms)
parseQuery(text) → { filters: Token[], freeText: string, errors: ParseError[] }
   ↓
search-index.applyFilters(filters)            ← coarse: O(sessions)
   ↓
search-index.matchText(freeText, candidates)   ← fine: existing substring + fuse
   ↓
SearchHit[]
```

## Implementation surface

| File | Change |
|---|---|
| `lib/query-parser.ts` *(new)* | Token grammar, `parseQuery()`, date resolver |
| `lib/search-index.ts` | New `applyFilters()` step before text search; expose distinct branches/tools/models for autocomplete |
| `app/api/search/route.ts` | Accept the raw query string as before; parsing happens server-side so it can use the index's distinct values |
| `app/api/search/suggest/route.ts` *(new)* | Returns suggestions for a given partial query (key list, value list per key) |
| `components/search-dialog.tsx` | Replace plain `<input>` with highlight-rendering input, parsed-preview row, autocomplete dropdown |
| `components/query-input.tsx` *(new)* | Shared component for both global and sidebar |
| `components/session-list.tsx` | Use `<QueryInput>` compact variant, scope to `project:` of current project |

## Accessibility

- Input has `aria-label="Search across all sessions"`, `aria-autocomplete="list"`, `aria-controls="search-suggestions"`, `aria-activedescendant=<focused option id>`.
- Suggestion dropdown is `role="listbox"`, each item `role="option"` with `aria-selected`.
- Parsed chips are not focusable as a group (would interfere with input
  focus); each chip's `×` button is focusable individually, keyboard-only
  way to remove a token without touching the input.
- Result count change announced via `aria-live="polite"`.
- Reduced motion: dropdown open/close uses `motion-safe:` Tailwind prefix.

## Performance budget

- Parser runs on every keystroke; must complete in <1ms for typical query
  (<200 chars). No regex backtracking; single-pass tokenization.
- Filter step on the index is O(sessions); for ~100 sessions this is
  microseconds.
- Autocomplete value lookups (`tool:`, `branch:`, `model:`) come from a
  cached `getDistinctValues()` on the index, built once per rebuild.
- Existing fuse.js fall back unchanged.

## Open questions resolved at design time

- **Chips inside input vs. inline highlight?** → inline highlight + chips
  in a separate preview row. Avoids keyboard / focus pitfalls.
- **Are unknown operators an error?** → no, fall back to literal
  substring; tag them `unknown` in the preview so the user sees why.
- **Case sensitivity?** → keys lowercase, values case-insensitive for
  `id`/`project`/`branch`/`model`, case-sensitive for `tool` (matches the
  actual tool name).
- **Date formats accepted?** → `today`, `yesterday`, `<N>(d|w|m)` for
  relative, `YYYY-MM-DD` for absolute. No time-of-day for now.

## Out of scope (future)

- Boolean grouping with parens.
- Multi-select on `has:` (e.g. `has:subagents,thinking`).
- Save / share named queries.
- Sidebar filter "facet panel" (checkbox UI built from the same parser).
