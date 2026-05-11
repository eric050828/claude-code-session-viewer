"use client";

import { Folder, FolderOpen } from "lucide-react";
import type { ProjectMeta } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RelativeTime } from "./relative-time";

export function ProjectTree({
  projects,
  activeId,
  onSelect,
}: {
  projects: ProjectMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-labelledby="projects-heading" className="px-2 py-3">
      <h2
        id="projects-heading"
        className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Projects ({projects.length})
      </h2>
      <ul className="space-y-0.5">
        {projects.map((p) => {
          const active = p.id === activeId;
          const segments = p.decodedPath.split("/").filter(Boolean);
          const display = segments[segments.length - 1] || p.decodedPath;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "group flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  active
                    ? "bg-brand/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                title={p.decodedPath}
              >
                {active ? (
                  <FolderOpen
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-brand"
                  />
                ) : (
                  <Folder aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                )}
                <span
                  className="min-w-0 flex-1 truncate font-medium"
                  translate="no"
                >
                  {display}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {p.sessionCount}
                </span>
              </button>
              {active && (
                <div className="px-2 py-1 text-[10px] font-mono text-muted-foreground">
                  <span translate="no">{p.decodedPath}</span>
                  <span className="ml-2">· <RelativeTime ts={p.lastModified} /></span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
