"use client";

import { updateSettings, useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "all", label: "All" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
] as const;

export function SourceFilter() {
  const { sourceFilter } = useSettings();
  return (
    <div
      role="group"
      aria-label="Filter by source"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => updateSettings({ sourceFilter: o.value })}
          aria-pressed={sourceFilter === o.value}
          className={cn(
            "h-6 rounded px-2 text-[11px] font-medium transition-colors",
            sourceFilter === o.value
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
