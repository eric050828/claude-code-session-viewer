"use client";

import {
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  GitPullRequestArrow,
  Lock,
  ListOrdered,
  Tag,
  Tags,
  UserCog,
} from "lucide-react";
import type { SessionEvent } from "@/lib/types";
import { useState } from "react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "permission-mode": Lock,
  "last-prompt": FileText,
  "queue-operation": ListOrdered,
  "file-history-snapshot": Clock,
  "ai-title": Tag,
  "custom-title": Tags,
  "agent-name": UserCog,
  progress: CheckCircle2,
  "pr-link": GitPullRequestArrow,
};

export function MetaEventBlock({ event }: { event: SessionEvent }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[event.type] || FileText;
  const summary = describe(event);
  return (
    <div className="mx-4 my-1 rounded border border-border/40 bg-muted/20 text-[11px] text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${event.type} event`}
        className="flex w-full min-w-0 items-center gap-2 px-2 py-1 text-left hover:bg-muted/40"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <Icon aria-hidden="true" className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="font-mono" translate="no">
          {event.type}
        </span>
        <span className="truncate">{summary}</span>
      </button>
      {open && (
        <pre className="overflow-x-auto border-t border-border/40 px-3 py-2 font-mono text-[10px] leading-relaxed">
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  );
}

function describe(ev: SessionEvent): string {
  switch (ev.type) {
    case "permission-mode":
      return `→ ${(ev as { permissionMode?: string }).permissionMode || ""}`;
    case "ai-title":
      return (ev as { aiTitle?: string }).aiTitle || "";
    case "custom-title":
      return (ev as { customTitle?: string }).customTitle || "";
    case "agent-name":
      return (ev as { agentName?: string }).agentName || "";
    case "pr-link":
      return (ev as { url?: string }).url || "";
    case "last-prompt":
      return "(saved last prompt)";
    case "queue-operation":
      return (ev as { operation?: string }).operation || "(queue)";
    case "file-history-snapshot":
      return "(file snapshot)";
    case "progress":
      return "(progress)";
    default:
      return "";
  }
}
