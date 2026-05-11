"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DetailContent } from "./app-shell";
import type { SessionEvent } from "@/lib/types";
import {
  defaultInputView,
  defaultResultView,
  getRenderer,
} from "./tool-renderers/index";
import { extractText } from "@/lib/utils";
import { MessageBlock } from "./message-block";
import { buildToolMap } from "./conversation-view";

export function DetailPane({
  detail,
  onClose,
  onShowDetail,
}: {
  detail: DetailContent | null;
  onClose: () => void;
  onShowDetail: (d: DetailContent | null) => void;
}) {
  if (!detail) return null;
  return (
    <aside
      aria-label={detail.kind === "subagent" ? "Sub-agent detail" : "Tool detail"}
      className={cn(
        "flex w-[480px] shrink-0 flex-col border-l border-border bg-card motion-safe:animate-slide-in",
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {detail.kind === "subagent" ? "Sub-agent" : "Tool detail"}
        </span>
        <span className="truncate font-mono text-xs" translate="no">
          {detail.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail pane (Esc)"
          aria-keyshortcuts="Escape"
          title="Close (Esc)"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
        {detail.kind === "tool" && <ToolDetail detail={detail} />}
        {detail.kind === "subagent" && (
          <SubagentDetail detail={detail} onShowDetail={onShowDetail} />
        )}
      </div>
    </aside>
  );
}

function ToolDetail({ detail }: { detail: DetailContent }) {
  const renderer = getRenderer(detail.toolName);
  const resultText = detail.toolResult
    ? extractText([{ type: "tool_result", content: detail.toolResult }])
    : "";
  return (
    <div className="space-y-3 p-3">
      <Section label="Tool">
        <div className="px-3 py-2 font-mono text-xs">
          <span
            className="text-emerald-700 dark:text-emerald-400"
            translate="no"
          >
            {detail.toolName}
          </span>
        </div>
      </Section>
      <Section label="Input">
        {renderer.inputView
          ? renderer.inputView(detail.toolInput)
          : defaultInputView(detail.toolInput)}
      </Section>
      {detail.toolResult != null && (
        <Section label={detail.toolResultIsError ? "Error" : "Result"}>
          {renderer.resultView
            ? renderer.resultView(resultText, !!detail.toolResultIsError)
            : defaultResultView(resultText, !!detail.toolResultIsError)}
        </Section>
      )}
      {detail.toolUseResult != null && (
        <Section label="Structured result">
          <pre className="max-h-[400px] overflow-auto rounded bg-background p-3 font-mono text-[10px] leading-relaxed text-foreground/80">
            {JSON.stringify(detail.toolUseResult, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-background/30">
      <div className="border-b border-border/40 bg-muted/20 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SubagentDetail({
  detail,
  onShowDetail,
}: {
  detail: DetailContent;
  onShowDetail: (d: DetailContent | null) => void;
}) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!detail.subagent) return;
    setLoading(true);
    fetch(
      `/api/subagent/${detail.subagent.projectId}/${detail.subagent.sessionId}/${detail.subagent.agentId}`,
    )
      .then((r) => r.json())
      .then((j) => setEvents(j.events || []))
      .finally(() => setLoading(false));
  }, [detail]);

  const toolMap = buildToolMap(events);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading sub-agent…
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-muted-foreground">
        (no events)
      </div>
    );
  }
  return (
    <div>
      {events.map((ev, i) => {
        if (
          ev.type === "attachment" &&
          (ev as { attachment?: { toolUseID?: string } }).attachment?.toolUseID &&
          toolMap.has(
            (ev as { attachment: { toolUseID: string } }).attachment.toolUseID,
          )
        )
          return null;
        return (
          <MessageBlock
            key={(ev.uuid as string) || i}
            event={ev}
            toolMap={toolMap}
            project={null}
            session={null}
            onShowDetail={onShowDetail}
          />
        );
      })}
    </div>
  );
}
