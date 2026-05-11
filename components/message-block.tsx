"use client";

import { useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Settings,
  User,
  Paperclip,
  AlertCircle,
} from "lucide-react";
import type {
  ProjectMeta,
  SessionEvent,
  SessionMeta,
} from "@/lib/types";
import { cn, extractText, formatTokens } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { Markdown } from "./markdown";
import { RelativeTime } from "./relative-time";
import { ThinkingBlock } from "./thinking-block";
import { ToolUseCard } from "./tool-use-card";
import type { ToolMap } from "./conversation-view";
import type { DetailContent } from "./app-shell";

export function MessageBlock({
  event,
  toolMap,
  project,
  session,
  onShowDetail,
}: {
  event: SessionEvent;
  toolMap: ToolMap;
  project: ProjectMeta | null;
  session: SessionMeta | null;
  onShowDetail: (d: DetailContent | null) => void;
}) {
  if (event.type === "user") return <UserMessage event={event} toolMap={toolMap} project={project} session={session} onShowDetail={onShowDetail} />;
  if (event.type === "assistant") return <AssistantMessage event={event} toolMap={toolMap} project={project} session={session} onShowDetail={onShowDetail} />;
  if (event.type === "system") return <SystemMessage event={event} />;
  if (event.type === "attachment") return <AttachmentMessage event={event} />;
  return null;
}

function MessageWrapper({
  role,
  timestamp,
  uuid,
  copyText,
  children,
  className,
}: {
  role: "user" | "assistant" | "system" | "attachment";
  timestamp?: string;
  uuid?: string;
  copyText?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const cfg = {
    user: { Icon: User, label: "User", color: "text-role-user", bg: "bg-role-user/5", ring: "ring-role-user/30" },
    assistant: { Icon: Bot, label: "Assistant", color: "text-brand", bg: "", ring: "" },
    system: { Icon: Settings, label: "System", color: "text-role-system", bg: "bg-role-system/5", ring: "" },
    attachment: { Icon: Paperclip, label: "Attachment", color: "text-role-attachment", bg: "bg-role-attachment/5", ring: "" },
  }[role];

  return (
    <div
      data-event-uuid={uuid}
      data-role={role}
      className={cn(
        "group relative px-5 py-4 transition",
        cfg.bg,
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/40",
            cfg.color,
          )}
        >
          <cfg.Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className={cn("text-xs font-semibold", cfg.color)}>
              {cfg.label}
            </span>
            {timestamp && (
              <span
                className="text-[10px] tabular-nums text-muted-foreground"
                data-skip-find
                title={timestamp}
              >
                <RelativeTime ts={timestamp} />
              </span>
            )}
            {copyText && (
              <CopyButton
                text={copyText}
                size="xs"
                className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"
                title={`Copy ${cfg.label.toLowerCase()} message`}
              />
            )}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function UserMessage({
  event,
  toolMap,
  project,
  session,
  onShowDetail,
}: {
  event: SessionEvent;
  toolMap: ToolMap;
  project: ProjectMeta | null;
  session: SessionMeta | null;
  onShowDetail: (d: DetailContent | null) => void;
}) {
  const msg = (event as { message?: { content?: unknown } }).message;
  const content = msg?.content;

  // If it's purely tool_results, skip (rendered with their tool_use)
  let hasNonToolResult = false;
  if (typeof content === "string") {
    hasNonToolResult = content.trim().length > 0;
  } else if (Array.isArray(content)) {
    hasNonToolResult = content.some(
      (b) => b && typeof b === "object" && (b as { type?: string }).type !== "tool_result",
    );
  }
  if (!hasNonToolResult) return null;

  const copyText = extractText(content);
  return (
    <MessageWrapper role="user" timestamp={event.timestamp} uuid={event.uuid} copyText={copyText || undefined}>
      <ContentBlocks content={content} toolMap={toolMap} project={project} session={session} onShowDetail={onShowDetail} skipToolResults />
    </MessageWrapper>
  );
}

function AssistantMessage({
  event,
  toolMap,
  project,
  session,
  onShowDetail,
}: {
  event: SessionEvent;
  toolMap: ToolMap;
  project: ProjectMeta | null;
  session: SessionMeta | null;
  onShowDetail: (d: DetailContent | null) => void;
}) {
  const msg = (event as {
    message?: {
      content?: unknown;
      model?: string;
      stop_reason?: string | null;
      usage?: Record<string, number | undefined> & {
        service_tier?: string;
      };
    };
  }).message;
  const content = msg?.content;
  const usage = msg?.usage;
  // Copy: just text blocks (skip tool_use/thinking — they have their own copy buttons)
  const copyText = (() => {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter(
        (b) =>
          b &&
          typeof b === "object" &&
          (b as { type?: string }).type === "text",
      )
      .map((b) => (b as { text?: string }).text || "")
      .join("\n\n");
  })();
  return (
    <MessageWrapper role="assistant" timestamp={event.timestamp} uuid={event.uuid} copyText={copyText || undefined}>
      <ContentBlocks content={content} toolMap={toolMap} project={project} session={session} onShowDetail={onShowDetail} />
      {(msg?.model || usage || msg?.stop_reason) && (
        <div
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground/70"
          data-skip-find
        >
          {msg?.model && <span>{msg.model}</span>}
          {msg?.stop_reason && msg.stop_reason !== "end_turn" && (
            <span
              className={cn(
                "rounded px-1",
                msg.stop_reason === "max_tokens"
                  ? "bg-red-500/20 text-red-700 dark:text-red-300"
                  : "bg-muted/40",
              )}
              title="stop_reason"
            >
              {msg.stop_reason}
            </span>
          )}
          {usage && (
            <UsageInline usage={usage} />
          )}
        </div>
      )}
    </MessageWrapper>
  );
}

function UsageInline({
  usage,
}: {
  usage: Record<string, number | undefined> & { service_tier?: string };
}) {
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const tooltip = [
    `input: ${inTok.toLocaleString()}`,
    `output: ${outTok.toLocaleString()}`,
    `cache read: ${cacheRead.toLocaleString()}`,
    `cache create: ${cacheCreate.toLocaleString()}`,
    usage.service_tier ? `tier: ${usage.service_tier}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className="flex items-center gap-2"
      title={tooltip}
      aria-label={`Tokens: ${formatTokens(inTok + cacheRead + cacheCreate)} in, ${formatTokens(outTok)} out`}
    >
      <span className="text-emerald-700 dark:text-emerald-400/80">
        ↓{formatTokens(inTok + cacheRead + cacheCreate)}
      </span>
      <span className="text-amber-700 dark:text-amber-300/80">
        ↑{formatTokens(outTok)}
      </span>
      {cacheRead > 0 && (
        <span className="text-muted-foreground/60">
          (cache {formatTokens(cacheRead)})
        </span>
      )}
    </span>
  );
}

function SystemMessage({ event }: { event: SessionEvent }) {
  const [open, setOpen] = useState(false);
  const ev = event as {
    subtype?: string;
    level?: string;
    hookCount?: number;
    hookErrors?: unknown[];
    preventedContinuation?: boolean;
    content?: unknown;
    timestamp?: string;
    uuid?: string;
  };
  const errors = Array.isArray(ev.hookErrors) ? ev.hookErrors.length : 0;
  return (
    <div data-event-uuid={ev.uuid} className="mx-4 my-1.5 rounded-md border border-border/40 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "h-3 w-3 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <Settings aria-hidden="true" className="h-3 w-3 text-role-system" />
        <span className="font-mono text-role-system">system</span>
        {ev.subtype && (
          <span className="font-mono text-muted-foreground" translate="no">
            / {ev.subtype}
          </span>
        )}
        {ev.level && (
          <span
            className={cn(
              "rounded px-1 text-[10px]",
              ev.level === "error"
                ? "bg-red-500/20 text-red-700 dark:text-red-400"
                : "bg-muted",
            )}
          >
            {ev.level}
          </span>
        )}
        {ev.hookCount != null && (
          <span className="text-[10px] text-muted-foreground">
            {ev.hookCount} hooks
          </span>
        )}
        {errors > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-red-700 dark:text-red-400">
            <AlertCircle aria-hidden="true" className="h-2.5 w-2.5" />
            {errors} errors
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          <RelativeTime ts={ev.timestamp} />
        </span>
      </button>
      {open && (
        <pre className="overflow-x-auto border-t border-border/40 px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {JSON.stringify(event, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AttachmentMessage({ event }: { event: SessionEvent }) {
  const [open, setOpen] = useState(false);
  const rawAtt = (event as { attachment?: Record<string, unknown> }).attachment ||
    {};
  const att = {
    type: rawAtt.type as string | undefined,
    hookName: rawAtt.hookName as string | undefined,
    hookEvent: rawAtt.hookEvent as string | undefined,
    toolUseID: rawAtt.toolUseID as string | undefined,
    command: rawAtt.command as string | undefined,
    stdout: rawAtt.stdout as string | undefined,
    stderr: rawAtt.stderr as string | undefined,
    content: rawAtt.content as string | undefined,
    exitCode: rawAtt.exitCode as number | undefined,
    durationMs: rawAtt.durationMs as number | undefined,
  };
  const ev = event as { timestamp?: string; uuid?: string };
  const type = String(att.type || "attachment");
  const exitCode = att.exitCode;
  return (
    <div data-event-uuid={ev.uuid} className="mx-4 my-1.5 rounded-md border border-border/40 bg-role-attachment/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "h-3 w-3 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <Paperclip aria-hidden="true" className="h-3 w-3 text-role-attachment" />
        <span className="font-mono text-role-attachment">attachment</span>
        <span className="font-mono text-muted-foreground" translate="no">
          / {type}
        </span>
        {att.hookName ? (
          <span
            className="font-mono text-[10px] text-muted-foreground"
            translate="no"
          >
            {String(att.hookName)}
          </span>
        ) : null}
        {exitCode != null && (
          <span
            className={cn(
              "rounded px-1 text-[10px]",
              exitCode === 0
                ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                : "bg-red-500/20 text-red-700 dark:text-red-400",
            )}
          >
            exit {exitCode}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          <RelativeTime ts={ev.timestamp} />
        </span>
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 py-2">
          {att.command && (
            <div className="mb-2 font-mono text-[11px] text-foreground">
              <span className="text-muted-foreground">$ </span>
              {String(att.command)}
            </div>
          )}
          {att.stdout && (
            <pre className="mb-2 overflow-x-auto rounded bg-background p-2 font-mono text-[10px] leading-relaxed text-emerald-700 dark:text-emerald-300">
              {String(att.stdout)}
            </pre>
          )}
          {att.stderr && (
            <pre className="mb-2 overflow-x-auto rounded bg-background p-2 font-mono text-[10px] leading-relaxed text-red-700 dark:text-red-300">
              {String(att.stderr)}
            </pre>
          )}
          {att.content && (
            <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {String(att.content)}
            </pre>
          )}
          {!att.command && !att.stdout && !att.stderr && !att.content && (
            <pre className="overflow-x-auto font-mono text-[10px] leading-relaxed text-muted-foreground">
              {JSON.stringify(att, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ContentBlocks({
  content,
  toolMap,
  project,
  session,
  onShowDetail,
  skipToolResults,
}: {
  content: unknown;
  toolMap: ToolMap;
  project: ProjectMeta | null;
  session: SessionMeta | null;
  onShowDetail: (d: DetailContent | null) => void;
  skipToolResults?: boolean;
}) {
  if (typeof content === "string") {
    return <Markdown>{content}</Markdown>;
  }
  if (!Array.isArray(content)) return null;
  return (
    <>
      {content.map((block, i) => {
        if (!block || typeof block !== "object") return null;
        const b = block as {
          type?: string;
          text?: string;
          thinking?: string;
          id?: string;
          name?: string;
          input?: unknown;
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        };
        if (b.type === "text" && typeof b.text === "string") {
          return <Markdown key={i}>{b.text}</Markdown>;
        }
        if (b.type === "thinking" && typeof b.thinking === "string") {
          return <ThinkingBlock key={i} thinking={b.thinking} />;
        }
        if (b.type === "tool_use") {
          return (
            <ToolUseCard
              key={i}
              toolUse={{ id: b.id, name: b.name, input: b.input }}
              pair={b.id ? toolMap.get(b.id) : undefined}
              project={project}
              session={session}
              onShowDetail={onShowDetail}
            />
          );
        }
        if (b.type === "tool_result" && !skipToolResults) {
          // standalone tool_result rendering
          return (
            <div
              key={i}
              className="my-1 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
            >
              tool_result for {b.tool_use_id?.slice(0, 8)}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}
