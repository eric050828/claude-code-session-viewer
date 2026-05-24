"use client";

import { useEffect, useState } from "react";
import { Clock, GitBranch, MessageSquare, Users, Wrench } from "lucide-react";
import type { SessionMeta } from "@/lib/types";
import { cn, formatBytes, truncate } from "@/lib/utils";
import { RelativeTime } from "./relative-time";

interface RecentItem {
  session: SessionMeta;
  projectId: string;
  projectDecodedPath: string;
}

/**
 * Empty-state card listing the most recently active sessions across all
 * projects. Shown when no session is selected. Same modified-click
 * semantics as the sidebar list — Cmd-click opens in a new tab.
 */
export function RecentSessions({
  onSelect,
}: {
  onSelect: (projectId: string, sessionId: string) => void;
}) {
  const [items, setItems] = useState<RecentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/recent?limit=12")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setItems(j.recent || []);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      aria-labelledby="recent-heading"
      className="w-full max-w-2xl"
    >
      <h2
        id="recent-heading"
        className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        <Clock aria-hidden="true" className="h-3 w-3" />
        Recent activity
      </h2>

      {error && (
        <div role="alert" className="text-xs text-muted-foreground">
          Could not load recent sessions: {error}
        </div>
      )}

      {items === null && !error && (
        <ul className="space-y-2" aria-live="polite" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <li
              key={i}
              className="h-[68px] animate-pulse rounded-md border border-border bg-card/50"
            />
          ))}
        </ul>
      )}

      {items && items.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No sessions yet. Run a Claude Code session and it will show up here.
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {items.map(({ session, projectId, projectDecodedPath }) => {
            const href = `?p=${encodeURIComponent(projectId)}&s=${encodeURIComponent(session.id)}`;
            return (
              <li key={`${projectId}/${session.id}`}>
                <a
                  href={href}
                  onClick={(e) => {
                    if (
                      e.metaKey ||
                      e.ctrlKey ||
                      e.shiftKey ||
                      e.button !== 0
                    )
                      return;
                    e.preventDefault();
                    onSelect(projectId, session.id);
                  }}
                  className={cn(
                    "group flex flex-col gap-1 px-4 py-3 text-inherit no-underline transition-colors hover:bg-muted/40",
                    "first:rounded-t-md last:rounded-b-md",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {session.isActive && (
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
                      className="truncate text-sm font-medium"
                      title={session.title}
                    >
                      {truncate(session.title, 80)}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      <RelativeTime ts={session.lastTimestamp} />
                    </span>
                  </div>
                  <div className="flex min-w-0 items-center gap-3 text-[10px] text-muted-foreground">
                    <span
                      className="truncate font-mono"
                      translate="no"
                      title={projectDecodedPath}
                    >
                      {projectDecodedPath}
                    </span>
                    {session.gitBranch && (
                      <span
                        className="flex shrink-0 items-center gap-1 font-mono"
                        translate="no"
                      >
                        <GitBranch
                          aria-hidden="true"
                          className="h-2.5 w-2.5"
                        />
                        {session.gitBranch}
                      </span>
                    )}
                    <span className="flex shrink-0 items-center gap-1 tabular-nums">
                      <MessageSquare
                        aria-hidden="true"
                        className="h-2.5 w-2.5"
                      />
                      {session.messageCount}
                    </span>
                    {session.toolUseCount > 0 && (
                      <span className="flex shrink-0 items-center gap-1 tabular-nums">
                        <Wrench aria-hidden="true" className="h-2.5 w-2.5" />
                        {session.toolUseCount}
                      </span>
                    )}
                    {session.hasSubagents && (
                      <span className="flex shrink-0 items-center gap-1 text-purple-700 dark:text-purple-400">
                        <Users aria-hidden="true" className="h-2.5 w-2.5" />
                        sub
                      </span>
                    )}
                    <span className="ml-auto shrink-0 font-mono tabular-nums">
                      {formatBytes(session.fileSize)}
                    </span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
