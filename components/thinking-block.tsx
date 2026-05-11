"use client";

import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { cn, truncate } from "@/lib/utils";
import { Markdown } from "./markdown";
import { CopyButton } from "./copy-button";

export function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-md border border-border/40 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <Brain
          aria-hidden="true"
          className="mt-0.5 h-3 w-3 shrink-0 text-purple-700 dark:text-purple-400"
        />
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-purple-700 dark:text-purple-400">
            Thinking
          </span>
          {!open && (
            <p className="mt-0.5 line-clamp-2 text-xs italic text-muted-foreground">
              {truncate(thinking, 200)}
            </p>
          )}
        </div>
      </button>
      {open && (
        <div className="group/cb relative border-t border-border/40 px-4 py-3 text-xs italic text-muted-foreground">
          <Markdown>{thinking}</Markdown>
          <CopyButton
            text={thinking}
            className="absolute right-2 top-2 bg-card/80 opacity-0 backdrop-blur transition-opacity group-hover/cb:opacity-100"
            title="Copy thinking"
          />
        </div>
      )}
    </div>
  );
}
