"use client";

import { RefreshCw, Search, Settings as Gear, Sparkles } from "lucide-react";

export function TopBar({
  onOpenSearch,
  onOpenSettings,
  onReload,
}: {
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onReload: () => void;
}) {
  return (
    // 3-column grid keeps the search visually centered even when the
    // logo or utility cluster changes width. Side columns are equal-width
    // (1fr) so the center column anchors to the viewport center.
    <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-card px-4">
      <div className="flex min-w-0 items-center gap-2">
        <div
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-brand/15 text-brand"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <span
          className="truncate text-sm font-semibold tracking-tight"
          translate="no"
        >
          Claude Code Session Viewer
        </span>
      </div>
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Open global search (Ctrl/Cmd + K)"
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-8 w-[40rem] max-w-full items-center gap-2 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground"
      >
        <Search aria-hidden="true" className="h-3.5 w-3.5" />
        <span className="truncate">Search across all sessions…</span>
        <kbd className="ml-auto shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
          {"⌘ K"}
        </kbd>
      </button>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Open settings"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Gear aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onReload}
          title="Reload projects"
          aria-label="Reload projects"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
}
