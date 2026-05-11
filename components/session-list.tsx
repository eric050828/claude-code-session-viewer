"use client";

import { useState } from "react";
import { GitBranch, MessageSquare, Wrench, Users } from "lucide-react";
import type { ProjectMeta, SessionMeta } from "@/lib/types";
import { cn, formatBytes, truncate } from "@/lib/utils";
import { RelativeTime } from "./relative-time";

export function SessionList({
  project,
  sessions,
  activeId,
  loading,
  onSelect,
}: {
  project: ProjectMeta | null;
  sessions: SessionMeta[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const filtered = filter
    ? sessions.filter(
        (s) =>
          s.title.toLowerCase().includes(filter.toLowerCase()) ||
          s.id.toLowerCase().includes(filter.toLowerCase()),
      )
    : sessions;

  if (!project) {
    return (
      <div className="px-4 py-6 text-xs text-muted-foreground">
        Select a project.
      </div>
    );
  }

  return (
    <section
      aria-labelledby="sessions-heading"
      className="flex h-full flex-col"
    >
      <div className="sticky top-0 z-10 border-b border-border bg-card px-3 py-2">
        <div className="mb-2 flex items-center justify-between">
          <h2
            id="sessions-heading"
            className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Sessions ({filtered.length})
          </h2>
        </div>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter sessions…"
          aria-label="Filter sessions by title or ID"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs transition-colors focus-visible:border-brand/50"
        />
      </div>
      {loading && (
        <div
          aria-live="polite"
          className="px-4 py-6 text-xs text-muted-foreground"
        >
          Loading…
        </div>
      )}
      <ul className="flex-1 overflow-y-auto scrollbar-thin">
        {filtered.map((s) => {
          const active = s.id === activeId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "group flex w-full min-w-0 flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors",
                  active
                    ? "border-brand bg-brand/5"
                    : "border-transparent hover:bg-muted/40",
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {s.isActive && (
                    <span
                      aria-label="Active session"
                      className="relative flex h-2 w-2 shrink-0"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 motion-safe:animate-ping"
                      />
                      <span
                        aria-hidden="true"
                        className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"
                      />
                    </span>
                  )}
                  <span
                    className={cn(
                      "truncate text-xs font-medium",
                      active ? "text-foreground" : "text-foreground/90",
                    )}
                    title={s.title}
                  >
                    {truncate(s.title, 60)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] tabular-nums text-muted-foreground">
                  <RelativeTime ts={s.lastTimestamp} />
                  <span className="flex items-center gap-1">
                    <MessageSquare aria-hidden="true" className="h-2.5 w-2.5" />
                    {s.messageCount}
                  </span>
                  {s.toolUseCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Wrench aria-hidden="true" className="h-2.5 w-2.5" />
                      {s.toolUseCount}
                    </span>
                  )}
                  {s.hasSubagents && (
                    <span className="flex items-center gap-1 text-purple-700 dark:text-purple-400">
                      <Users aria-hidden="true" className="h-2.5 w-2.5" />
                      sub
                    </span>
                  )}
                </div>
                {s.gitBranch && (
                  <div className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                    <GitBranch aria-hidden="true" className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate font-mono" translate="no">
                      {s.gitBranch}
                    </span>
                    <span className="ml-auto shrink-0">
                      {formatBytes(s.fileSize)}
                    </span>
                  </div>
                )}
                <div
                  className="font-mono text-[9px] text-muted-foreground/60"
                  translate="no"
                >
                  {s.id.slice(0, 8)}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
