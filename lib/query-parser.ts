// Token-based search query parser for ccsv. See docs/superpowers/specs/
// 2026-05-15-token-search-design.md for the design.
//
// Grammar:
//   query    = (token | freeText | quoted)*
//   token    = '-'? key ':' value
//   value    = unquoted | quoted
//   unquoted = [^\s"]+
//   quoted   = '"' [^"]* '"'
//
// All tokens AND together. Free text (everything that isn't a token) joins
// into one big space-separated substring needle.

export type Operator =
  | "id"
  | "project"
  | "branch"
  | "tool"
  | "model"
  | "has"
  | "type"
  | "before"
  | "after"
  | "source";

export const KNOWN_OPERATORS: Operator[] = [
  "id",
  "project",
  "branch",
  "tool",
  "model",
  "has",
  "type",
  "before",
  "after",
  "source",
];

export const HAS_VALUES = ["subagents", "thinking", "errors", "active"] as const;
export type HasFlag = (typeof HAS_VALUES)[number];

export const SOURCE_VALUES = ["claude", "codex"] as const;
export type SourceValue = (typeof SOURCE_VALUES)[number];

export const TYPE_VALUES = [
  "user",
  "assistant",
  "thinking",
  "tool_input",
  "tool_result",
  "title",
] as const;
export type MatchType = (typeof TYPE_VALUES)[number];

export interface Token {
  key: Operator | string; // operator name; unknown ones become free-text fallback
  value: string;
  negate: boolean;
  /** byte offsets into the original query string, [start, end) inclusive of any leading `-`. */
  range: [number, number];
  /** true when `key` isn't in KNOWN_OPERATORS — UI shows these as "unknown". */
  unknown?: boolean;
  /** parse error for this token (e.g. bad date); the UI flags it in red. */
  error?: string;
  /** for date operators, the resolved absolute Date. */
  resolved?: Date;
}

export interface ParsedQuery {
  filters: Token[];
  freeText: string;
  /** parse-time errors (not bound to a specific token). */
  errors: string[];
  /** original query for round-tripping. */
  raw: string;
}

export function parseQuery(raw: string): ParsedQuery {
  const filters: Token[] = [];
  const freeParts: string[] = [];
  const errors: string[] = [];
  let i = 0;
  const text = raw;

  while (i < text.length) {
    // skip whitespace
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    const wordStart = i;
    // is this a `key:value` token?
    let negate = false;
    let j = i;
    if (text[j] === "-") {
      negate = true;
      j++;
    }
    const keyStart = j;
    while (j < text.length && /[a-zA-Z]/.test(text[j])) j++;
    if (j > keyStart && text[j] === ":") {
      const key = text.slice(keyStart, j).toLowerCase();
      j++; // consume ':'
      // read value
      let value: string;
      if (text[j] === '"') {
        // quoted
        const close = text.indexOf('"', j + 1);
        if (close < 0) {
          // unterminated; consume rest as value, flag error
          value = text.slice(j + 1);
          j = text.length;
          errors.push(`Unterminated quoted value for ${key}:`);
        } else {
          value = text.slice(j + 1, close);
          j = close + 1;
        }
      } else {
        const valStart = j;
        while (j < text.length && !/\s/.test(text[j])) j++;
        value = text.slice(valStart, j);
      }

      const token: Token = {
        key,
        value,
        negate,
        range: [wordStart, j],
      };
      if (!(KNOWN_OPERATORS as string[]).includes(key)) {
        token.unknown = true;
      } else {
        validateToken(token);
      }
      filters.push(token);
      i = j;
      continue;
    }

    // not a token; consume to next whitespace as free text
    while (j < text.length && !/\s/.test(text[j])) j++;
    const word = text.slice(wordStart, j);
    // strip surrounding quotes from a bare free-text "..." word
    const stripped =
      word.length >= 2 && word[0] === '"' && word[word.length - 1] === '"'
        ? word.slice(1, -1)
        : word;
    freeParts.push(stripped);
    i = j;
  }

  return {
    filters,
    freeText: freeParts.join(" ").trim(),
    errors,
    raw,
  };
}

function validateToken(token: Token): void {
  if (!token.value) {
    token.error = `${token.key}: value is empty`;
    return;
  }
  if (token.key === "has" && !(HAS_VALUES as readonly string[]).includes(token.value)) {
    token.error = `has: must be one of ${HAS_VALUES.join("/")}`;
  }
  if (token.key === "type" && !(TYPE_VALUES as readonly string[]).includes(token.value)) {
    token.error = `type: must be one of ${TYPE_VALUES.join("/")}`;
  }
  if (token.key === "source" && !(SOURCE_VALUES as readonly string[]).includes(token.value)) {
    token.error = `source: must be one of ${SOURCE_VALUES.join("/")}`;
  }
  if (token.key === "before" || token.key === "after") {
    const d = resolveDate(token.value);
    if (!d) {
      token.error = `${token.key}: couldn't parse "${token.value}" — try 7d, today, or YYYY-MM-DD`;
    } else {
      token.resolved = d;
    }
  }
}

/**
 * Resolve a user-supplied date string to a Date.
 * Accepts: today, yesterday, Nd/Nw/Nm (relative), YYYY-MM-DD.
 * Returns null if the format isn't recognized.
 */
export function resolveDate(value: string): Date | null {
  const v = value.toLowerCase().trim();
  const now = new Date();
  if (v === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (v === "yesterday") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 1);
    return d;
  }
  // relative: 7d / 3w / 2m
  const rel = v.match(/^(\d+)([dwm])$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    const d = new Date(now);
    if (unit === "d") d.setDate(d.getDate() - n);
    else if (unit === "w") d.setDate(d.getDate() - n * 7);
    else if (unit === "m") d.setMonth(d.getMonth() - n);
    return d;
  }
  // ISO date: 2026-05-04
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(
      parseInt(iso[1], 10),
      parseInt(iso[2], 10) - 1,
      parseInt(iso[3], 10),
    );
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }
  // ISO-ish fallback (let JS parser try)
  const parsed = Date.parse(v);
  if (!Number.isNaN(parsed)) return new Date(parsed);
  return null;
}
