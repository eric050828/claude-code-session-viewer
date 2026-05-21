"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Search, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseQuery, type Token } from "@/lib/query-parser";

interface Suggestion {
  value: string;
  hint?: string;
  count?: number;
}

interface QueryInputProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  /** restrict autocomplete (e.g. sidebar hides `project:`) */
  hideOperators?: string[];
  /** smaller surface for sidebar */
  compact?: boolean;
  className?: string;
  /** id for `aria-controls` from a parent listbox */
  ariaResultsId?: string;
  /** show the parsed-chip preview row */
  showPreview?: boolean;
}

export interface QueryInputHandle {
  focus(): void;
}

export const QueryInput = forwardRef<QueryInputHandle, QueryInputProps>(
  function QueryInput(
    {
      value,
      onChange,
      onSubmit,
      placeholder,
      hideOperators = [],
      compact = false,
      className,
      ariaResultsId,
      showPreview = true,
    },
    ref,
  ) {
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

    const [cursor, setCursor] = useState(0);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    // `wantShown` = user intent (focused / typing); actual visibility AND-s
    // it with "we have something to show". Decoupling these is what keeps
    // the dropdown from auto-opening on initial render before the user
    // touches the input.
    const [wantShown, setWantShown] = useState(false);
    const [activeSuggestion, setActiveSuggestion] = useState(0);
    const showSuggestions = wantShown && suggestions.length > 0;

    const parsed = useMemo(() => parseQuery(value), [value]);

    // The word the cursor is currently inside / just after.
    const currentWord = useMemo(() => {
      const before = value.slice(0, cursor);
      const wsBefore = before.search(/\S+$/);
      const start = wsBefore === -1 ? cursor : wsBefore;
      // word extends until next whitespace or end
      let end = cursor;
      while (end < value.length && !/\s/.test(value[end])) end++;
      return { start, end, text: value.slice(start, end) };
    }, [value, cursor]);

    // Decompose the current word into (key, prefix) for suggestion fetching.
    // Empty word (focus on empty input, or cursor right after a space) falls
    // back to the operator menu so users see what filters exist without
    // having to type a character first.
    const lookup = useMemo(() => {
      const t = currentWord.text;
      if (!t) return { mode: "operator" as const, prefix: "" };
      const negated = t.startsWith("-");
      const body = negated ? t.slice(1) : t;
      const colon = body.indexOf(":");
      if (colon < 0) {
        return { mode: "operator" as const, prefix: body.toLowerCase() };
      }
      return {
        mode: "value" as const,
        key: body.slice(0, colon).toLowerCase(),
        prefix: body.slice(colon + 1),
      };
    }, [currentWord.text]);

    // Fetch suggestions whenever lookup changes. Does NOT touch `wantShown`
    // — visibility is purely driven by focus + typing, not by the fetch
    // completing. That way an unfocused input never spontaneously pops
    // its dropdown on initial page load.
    useEffect(() => {
      if (!lookup) {
        setSuggestions([]);
        return;
      }
      let cancelled = false;
      const key = lookup.mode === "operator" ? "" : lookup.key;
      const url = `/api/search/suggest?key=${encodeURIComponent(key)}&prefix=${encodeURIComponent(lookup.prefix)}`;
      fetch(url)
        .then((r) => r.json())
        .then((j) => {
          if (cancelled) return;
          const raw: Suggestion[] = j.suggestions || [];
          const filtered = raw.filter(
            (s) =>
              !hideOperators.some(
                (op) =>
                  s.value.startsWith(`${op}:`) ||
                  s.value === `${op}:`,
              ),
          );
          setSuggestions(filtered);
          setActiveSuggestion(0);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [lookup, hideOperators.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

    const acceptSuggestion = useCallback(
      (s: Suggestion) => {
        if (!lookup) return;
        const negated = currentWord.text.startsWith("-");
        const prefix = negated ? "-" : "";
        let replacement: string;
        let cursorOffset: number;

        if (lookup.mode === "operator") {
          // value is "operator:" (with colon)
          replacement = prefix + s.value;
          cursorOffset = replacement.length;
        } else {
          // value-completion: rebuild "[-]key:newvalue"
          const needsQuote = /\s/.test(s.value);
          const val = needsQuote ? `"${s.value}"` : s.value;
          replacement = `${prefix}${lookup.key}:${val}`;
          cursorOffset = replacement.length;
        }

        const before = value.slice(0, currentWord.start);
        const after = value.slice(currentWord.end);
        // add trailing space when completing a value so the user can keep typing
        const sep = lookup.mode === "value" && !after.startsWith(" ") ? " " : "";
        const next = before + replacement + sep + after;
        onChange(next);
        const newCursor = before.length + replacement.length + sep.length;
        requestAnimationFrame(() => {
          if (!inputRef.current) return;
          inputRef.current.focus();
          inputRef.current.setSelectionRange(newCursor, newCursor);
          setCursor(newCursor);
        });
        // Closing after accept; if the lookup changes (next word), the
        // onChange handler below re-opens via setWantShown(true).
        setWantShown(false);
      },
      [lookup, currentWord, value, onChange],
    );

    const removeToken = useCallback(
      (token: Token) => {
        const [start, end] = token.range;
        // also eat one leading whitespace if present (so we don't leave double-spaces)
        const adjStart =
          start > 0 && /\s/.test(value[start - 1]) ? start - 1 : start;
        const next = value.slice(0, adjStart) + value.slice(end);
        onChange(next.trimStart());
        requestAnimationFrame(() => inputRef.current?.focus());
      },
      [value, onChange],
    );

    const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (showSuggestions && suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveSuggestion((i) => Math.min(i + 1, suggestions.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveSuggestion((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          acceptSuggestion(suggestions[activeSuggestion]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setWantShown(false);
          return;
        }
      }
      // Backspace on empty word and existing token to the left → remove that token.
      if (
        e.key === "Backspace" &&
        cursor > 0 &&
        value.slice(cursor - 1, cursor) === " "
      ) {
        const before = value.slice(0, cursor - 1);
        const lastTokenMatch = parsed.filters.findLast?.((t) => t.range[1] <= before.length);
        if (lastTokenMatch && lastTokenMatch.range[1] === before.length) {
          e.preventDefault();
          removeToken(lastTokenMatch);
          return;
        }
      }
      if (e.key === "Enter") {
        if (showSuggestions && suggestions[activeSuggestion]) {
          e.preventDefault();
          acceptSuggestion(suggestions[activeSuggestion]);
          return;
        }
        onSubmit?.();
      }
    };

    const sizing = compact
      ? "h-7 px-2 text-xs"
      : "h-9 px-3 text-sm";

    return (
      <div className={cn("relative", className)}>
        {/* Input row */}
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border border-border bg-background transition-shadow focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/40",
            sizing,
          )}
        >
          <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setCursor(e.target.selectionStart || 0);
              setWantShown(true); // typing always re-opens the dropdown
            }}
            onSelect={(e) =>
              setCursor((e.target as HTMLInputElement).selectionStart || 0)
            }
            onClick={(e) =>
              setCursor((e.target as HTMLInputElement).selectionStart || 0)
            }
            onKeyUp={(e) =>
              setCursor((e.target as HTMLInputElement).selectionStart || 0)
            }
            onKeyDown={handleKeyDown}
            onFocus={() => setWantShown(true)}
            onBlur={() => setTimeout(() => setWantShown(false), 150)}
            placeholder={placeholder}
            aria-label="Search query"
            aria-autocomplete="list"
            aria-controls={ariaResultsId}
            aria-expanded={showSuggestions}
            autoComplete="off"
            spellCheck={false}
            autoCorrect="off"
            className="flex-1 bg-transparent placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0"
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                inputRef.current?.focus();
              }}
              aria-label="Clear query"
              className="rounded text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Parsed-token preview row */}
        {showPreview && (parsed.filters.length > 0 || parsed.freeText) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
            {parsed.filters.map((t, i) => (
              <TokenChip
                key={`${t.range[0]}-${i}`}
                token={t}
                onRemove={() => removeToken(t)}
              />
            ))}
            {parsed.freeText && (
              <span className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-muted-foreground">
                <span className="opacity-50">free:</span> {parsed.freeText}
              </span>
            )}
          </div>
        )}

        {/* Suggestion dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <ul
            role="listbox"
            aria-label="Search suggestions"
            className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg motion-safe:animate-fade-in"
          >
            {suggestions.map((s, i) => (
              <li
                key={s.value + i}
                role="option"
                aria-selected={i === activeSuggestion}
                onMouseDown={(e) => {
                  // mousedown so click fires before input blur
                  e.preventDefault();
                  acceptSuggestion(s);
                }}
                onMouseEnter={() => setActiveSuggestion(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-3 py-1 text-xs",
                  i === activeSuggestion
                    ? "bg-brand/10 text-foreground"
                    : "text-muted-foreground",
                )}
              >
                <span className="font-mono">{s.value}</span>
                {s.count != null && (
                  <span className="ml-auto tabular-nums text-[10px] text-muted-foreground/60">
                    ({s.count})
                  </span>
                )}
                {s.hint && (
                  <span
                    className={cn(
                      "text-[10px] text-muted-foreground/70",
                      s.count == null && "ml-auto",
                    )}
                  >
                    {s.hint}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);

function TokenChip({
  token,
  onRemove,
}: {
  token: Token;
  onRemove: () => void;
}) {
  const isError = !!token.error;
  const isUnknown = token.unknown;
  return (
    <span
      className={cn(
        "group/chip inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono",
        isError
          ? "border border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
          : isUnknown
            ? "bg-muted text-muted-foreground"
            : "bg-brand/10 text-brand-fg-dark dark:text-brand",
        token.negate && "line-through opacity-75",
      )}
      title={
        token.error ||
        (token.resolved
          ? `${token.key}: ${token.resolved.toISOString().slice(0, 10)}`
          : undefined)
      }
    >
      {isError && <AlertCircle aria-hidden="true" className="h-2.5 w-2.5" />}
      {token.negate && <span className="opacity-70">−</span>}
      <span className="opacity-60">{token.key}:</span>
      <span>{token.value || "?"}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${token.key} filter`}
        className="-mr-1 ml-0.5 rounded px-0.5 opacity-40 transition-opacity hover:opacity-100 group-hover/chip:opacity-100"
      >
        <X aria-hidden="true" className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}
