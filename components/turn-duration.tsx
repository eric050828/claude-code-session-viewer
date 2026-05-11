"use client";

import { Timer } from "lucide-react";
import type { SessionEvent } from "@/lib/types";
import { formatDuration } from "@/lib/utils";

export function TurnDuration({ event }: { event: SessionEvent }) {
  const ev = event as {
    durationMs?: number;
    messageCount?: number;
    uuid?: string;
  };
  if (ev.durationMs == null) return null;
  const slow = ev.durationMs > 30_000;
  return (
    <div
      data-event-uuid={ev.uuid}
      role="separator"
      aria-label={`Turn duration ${formatDuration(ev.durationMs)}${
        ev.messageCount ? `, ${ev.messageCount} messages` : ""
      }`}
      className="my-2 flex items-center gap-3 px-5"
    >
      <div aria-hidden="true" className="h-px flex-1 bg-border/40" />
      <div
        aria-hidden="true"
        className="flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground"
      >
        <Timer className="h-3 w-3 opacity-70" />
        <span className={slow ? "text-amber-700 dark:text-amber-300" : ""}>
          {formatDuration(ev.durationMs)}
        </span>
        {typeof ev.messageCount === "number" && ev.messageCount > 0 && (
          <>
            <span className="opacity-40">·</span>
            <span>{ev.messageCount} msgs</span>
          </>
        )}
      </div>
      <div aria-hidden="true" className="h-px flex-1 bg-border/40" />
    </div>
  );
}
