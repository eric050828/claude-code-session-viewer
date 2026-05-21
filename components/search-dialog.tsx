"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Filter,
  FileText,
  Hash,
  Loader2,
  MessageSquare,
  Wrench,
} from "lucide-react";
import type { ProjectMeta, SearchHit } from "@/lib/types";
import { cn } from "@/lib/utils";
import { QueryInput, type QueryInputHandle } from "./query-input";
import { parseQuery } from "@/lib/query-parser";

const ICONS: Record<SearchHit["matchType"], React.ComponentType<{ className?: string }>> = {
  text: MessageSquare,
  thinking: Brain,
  tool_input: Wrench,
  tool_result: Wrench,
  title: Hash,
};

const EXAMPLES = [
  "id:fb44f1ef",
  "tool:Bash signature",
  "branch:main has:subagents",
  "after:7d type:thinking",
  "-tool:Read compaction",
];

export function SearchDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  onHit,
  projects,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** controlled — owner (AppShell) keeps the URL in sync. */
  query: string;
  onQueryChange: (next: string) => void;
  onHit: (hit: SearchHit) => void;
  projects: ProjectMeta[];
}) {
  const q = query;
  const setQ = onQueryChange;
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  // QueryInput tells us when its suggestion dropdown is open so we can
  // defer arrow-key handling to it without sniffing the DOM.
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const inputRef = useRef<QueryInputHandle>(null);
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const parsed = useMemo(() => parseQuery(q), [q]);
  const freeText = parsed.freeText;

  useEffect(() => {
    if (!open) {
      setHits([]);
      setActive(0);
    } else {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&limit=80`,
        );
        const j = await r.json();
        if (!cancelled) {
          setHits(j.hits || []);
          setActive(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  // Result-list keyboard nav. Defers to QueryInput when its suggestion
  // dropdown is open (QueryInput handles arrow keys for the dropdown
  // itself); otherwise drives the result-row selection.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (suggestionsOpen) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, hits.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter" && hits[active]) {
        onHit(hits[active]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hits, active, onHit, suggestionsOpen]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 motion-safe:animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[15%] z-50 w-[720px] max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-2xl motion-safe:animate-fade-in">
          <Dialog.Title className="sr-only">Search sessions</Dialog.Title>
          <Dialog.Description className="sr-only">
            Type a query to search across all projects and sessions. Use the
            arrow keys to navigate results and Enter to open. Use operators
            like id:, tool:, branch:, has:, before:, after: to filter.
          </Dialog.Description>

          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <QueryInput
                  ref={inputRef}
                  value={q}
                  onChange={setQ}
                  placeholder="Search… try id:abc12345 or tool:Bash"
                  ariaResultsId="search-results"
                  onSuggestionsOpenChange={setSuggestionsOpen}
                />
              </div>
              {loading && (
                <Loader2
                  aria-label="Searching"
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin"
                />
              )}
              <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                Esc
              </kbd>
            </div>
            {!q.trim() && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                <Filter aria-hidden="true" className="h-3 w-3" />
                <span>Try:</span>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => {
                      setQ(ex);
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                    className="rounded bg-muted/50 px-1.5 py-0.5 font-mono hover:bg-muted hover:text-foreground"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            className="max-h-[480px] overflow-y-auto overscroll-contain scrollbar-thin"
            id="search-results"
            role="listbox"
            aria-label="Search results"
          >
            {!q.trim() && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                Type to search across <b>all projects and all sessions</b>:
                user/assistant text, thinking, tool inputs, and tool results.
              </div>
            )}
            {q.trim() && !loading && hits.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                <div>No matches.</div>
                {parsed.filters.length > 0 && (
                  <div className="mt-2 text-[10px] text-muted-foreground/70">
                    Try removing a filter — e.g.{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono">
                      {parsed.filters[parsed.filters.length - 1].key}:
                      {parsed.filters[parsed.filters.length - 1].value}
                    </code>
                  </div>
                )}
              </div>
            )}
            <span aria-live="polite" className="sr-only">
              {q.trim() && !loading
                ? `${hits.length} result${hits.length === 1 ? "" : "s"}`
                : ""}
            </span>
            <ul>
              {hits.map((h, i) => {
                const Icon = ICONS[h.matchType] || FileText;
                const project = projectMap.get(h.projectId);
                const href =
                  `?p=${encodeURIComponent(h.projectId)}&s=${encodeURIComponent(h.sessionId)}` +
                  (h.eventUuid ? `&e=${encodeURIComponent(h.eventUuid)}` : "");
                return (
                  <li key={i} role="option" aria-selected={i === active}>
                    <a
                      href={href}
                      onMouseEnter={() => setActive(i)}
                      onClick={(e) => {
                        // Modified clicks fall through so Cmd/middle-click
                        // opens the target session in a new tab.
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                          return;
                        e.preventDefault();
                        onHit(h);
                      }}
                      className={cn(
                        "flex w-full min-w-0 flex-col gap-1 border-l-2 px-4 py-2.5 text-left no-underline text-inherit transition-colors",
                        i === active
                          ? "border-brand bg-brand/5"
                          : "border-transparent hover:bg-muted/40",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
                        <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
                        <span className="font-mono uppercase">
                          {h.matchType.replace("_", " ")}
                        </span>
                        {h.via === "filter" && (
                          <span
                            className="rounded bg-brand/15 px-1 py-px font-mono text-[9px] text-brand"
                            title="Matched by token filter"
                          >
                            filter
                          </span>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="truncate font-mono" translate="no">
                          {project?.decodedPath || h.projectId}
                        </span>
                        <span
                          className="ml-auto shrink-0 font-mono"
                          translate="no"
                        >
                          {h.sessionId.slice(0, 8)}
                        </span>
                      </div>
                      <div className="text-xs leading-relaxed text-foreground/90">
                        <Highlighted text={h.excerpt} query={freeText} />
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex items-center gap-3 border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
            <span className="whitespace-nowrap">
              <kbd className="font-mono">↑↓</kbd>&nbsp;navigate
            </span>
            <span className="whitespace-nowrap">
              <kbd className="font-mono">↵</kbd>&nbsp;open
            </span>
            <span className="whitespace-nowrap">
              <kbd className="font-mono">Tab</kbd>&nbsp;complete
            </span>
            <span className="whitespace-nowrap">
              <kbd className="font-mono">Esc</kbd>&nbsp;close
            </span>
            <span className="ml-auto tabular-nums">{hits.length} results</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const ql = query.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const idx = lower.indexOf(ql, i);
    if (idx < 0) {
      out.push(<span key={key++}>{text.slice(i)}</span>);
      break;
    }
    if (idx > i) out.push(<span key={key++}>{text.slice(i, idx)}</span>);
    out.push(
      <mark
        key={key++}
        className="rounded bg-brand/30 px-0.5 text-foreground"
      >
        {text.slice(idx, idx + ql.length)}
      </mark>,
    );
    i = idx + ql.length;
  }
  return <>{out}</>;
}
