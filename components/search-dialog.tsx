"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import {
  Brain,
  FileText,
  Hash,
  Loader2,
  MessageSquare,
  Search,
  Wrench,
} from "lucide-react";
import type { ProjectMeta, SearchHit } from "@/lib/types";
import { cn, formatRelative } from "@/lib/utils";

const ICONS: Record<SearchHit["matchType"], React.ComponentType<{ className?: string }>> = {
  text: MessageSquare,
  thinking: Brain,
  tool_input: Wrench,
  tool_result: Wrench,
  title: Hash,
};

export function SearchDialog({
  open,
  onOpenChange,
  onHit,
  projects,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onHit: (hit: SearchHit) => void;
  projects: ProjectMeta[];
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  useEffect(() => {
    if (!open) {
      setQ("");
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
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const onKey = (e: React.KeyboardEvent) => {
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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 motion-safe:animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[20%] z-50 w-[640px] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-2xl motion-safe:animate-fade-in">
          <Dialog.Title className="sr-only">Search sessions</Dialog.Title>
          <Dialog.Description className="sr-only">
            Type a query to search across all projects and sessions. Use the
            arrow keys to navigate results and Enter to open.
          </Dialog.Description>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Search aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            <input
              ref={inputRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search across all sessions…"
              aria-label="Search across all sessions"
              aria-controls="search-results"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0"
            />
            {loading && (
              <Loader2
                aria-label="Searching"
                className="h-3.5 w-3.5 text-muted-foreground motion-safe:animate-spin"
              />
            )}
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              Esc
            </kbd>
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
                No matches.
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
                return (
                  <li key={i} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => onHit(h)}
                      className={cn(
                        "flex w-full min-w-0 flex-col gap-1 border-l-2 px-4 py-2.5 text-left transition-colors",
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
                        <span aria-hidden="true">·</span>
                        <span
                          className="truncate font-mono"
                          translate="no"
                        >
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
                        <Highlighted text={h.excerpt} query={q} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex items-center gap-3 border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> open</span>
            <span><kbd className="font-mono">Esc</kbd> close</span>
            <span className="ml-auto">{hits.length} results</span>
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

// keep import non-empty
export const _formatRelative = formatRelative;
