"use client";

import { Search, RefreshCw, Settings as Gear, Sparkles } from "lucide-react";

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
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <div className="flex items-center gap-2">
        <div
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded bg-brand/15 text-brand"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-semibold tracking-tight" translate="no">
          Claude Code Session Viewer
        </span>
      </div>
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Open global search (Ctrl/Cmd + K)"
        aria-keyshortcuts="Meta+K Control+K"
        className="ml-4 flex h-8 w-80 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground"
      >
        <Search aria-hidden="true" className="h-3.5 w-3.5" />
        <span>Search across all sessions…</span>
        <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
          {"⌘ K"}
        </kbd>
      </button>
      <div className="flex-1" />
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
    </header>
  );
}
