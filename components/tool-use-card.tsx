"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  Maximize2,
  Users,
  Wrench,
} from "lucide-react";
import type { ProjectMeta, SessionEvent, SessionMeta } from "@/lib/types";
import { cn, extractText, truncate } from "@/lib/utils";
import {
  defaultInputView,
  defaultResultView,
  getRenderer,
} from "./tool-renderers/index";
import type { ToolStat } from "./tool-renderers/index";
import type { DetailContent } from "./app-shell";

export function ToolUseCard({
  toolUse,
  pair,
  project,
  session,
  onShowDetail,
}: {
  toolUse: { id?: string; name?: string; input?: unknown };
  pair?: {
    toolUse: { name?: string; id?: string; input?: unknown } | null;
    toolResult: { content?: unknown; is_error?: boolean } | null;
    toolUseResult?: unknown;
    attachments: SessionEvent[];
  };
  project: ProjectMeta | null;
  session: SessionMeta | null;
  onShowDetail: (d: DetailContent | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const renderer = getRenderer(toolUse.name);
  const summary = renderer.summary(toolUse.input);
  const isError = pair?.toolResult?.is_error || false;
  const resultText = pair?.toolResult
    ? extractText([{ type: "tool_result", content: pair.toolResult.content }])
    : "";
  const stats: ToolStat[] = renderer.stats
    ? renderer.stats(toolUse.input, pair?.toolUseResult ?? null)
    : [];

  // Special: Task tool → enable sub-agent jump from card
  const isTask = toolUse.name === "Task" || toolUse.name === "Agent";
  // attempt to find subagent_type for label
  const subagentInput = toolUse.input as
    | { subagent_type?: string; description?: string }
    | undefined;

  const openDetail = () => {
    onShowDetail({
      kind: "tool",
      title: toolUse.name || "tool",
      toolName: toolUse.name,
      toolInput: toolUse.input,
      toolResult: pair?.toolResult?.content,
      toolResultIsError: isError,
      toolUseResult: pair?.toolUseResult,
    });
  };

  const toggleId = `tool-${toolUse.id || "unknown"}-body`;
  return (
    <div
      data-tool-use-id={toolUse.id}
      className={cn(
        "my-2 overflow-hidden rounded-lg border bg-card/40 transition-colors",
        isError ? "border-red-500/40" : "border-border/60 hover:border-border",
      )}
    >
      {/* Row uses role="button" rather than a real <button> because it has to
          contain another interactive control (the "Open in detail pane"
          button) — HTML forbids nested <button>s. Keyboard handlers below
          give it equivalent semantics. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={toggleId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        {isTask ? (
          <Users
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-purple-700 dark:text-purple-400"
          />
        ) : (
          <Wrench
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400"
          />
        )}
        <span
          className={cn(
            "shrink-0 font-mono text-[11px] font-semibold",
            isTask
              ? "text-purple-700 dark:text-purple-400"
              : "text-emerald-700 dark:text-emerald-400",
          )}
          translate="no"
        >
          {toolUse.name || "tool"}
        </span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
          title={summary}
        >
          {truncate(summary, 200)}
        </span>
        {stats.map((s, i) => (
          <span
            key={i}
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]",
              s.tone === "ok"
                ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                : s.tone === "warn"
                  ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                  : s.tone === "danger"
                    ? "bg-red-500/20 text-red-700 dark:text-red-300"
                    : s.tone === "info"
                      ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                      : "bg-muted text-muted-foreground",
            )}
          >
            {s.label && <span className="mr-1 opacity-60">{s.label}</span>}
            {s.value}
          </span>
        ))}
        {isError && (
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-red-700 dark:text-red-400">
            <AlertTriangle aria-hidden="true" className="h-3 w-3" />
            error
          </span>
        )}
        {pair?.attachments && pair.attachments.length > 0 && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            +{pair.attachments.length} hooks
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openDetail();
          }}
          aria-label="Open in detail pane"
          title="Open in detail pane"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Maximize2 aria-hidden="true" className="h-3 w-3" />
        </button>
      </div>

      {open && (
        <div id={toggleId} className="border-t border-border/40 bg-background/30">
          <SectionLabel>Input</SectionLabel>
          {renderer.inputView
            ? renderer.inputView(toolUse.input)
            : defaultInputView(toolUse.input)}

          {pair?.toolResult && (
            <>
              <SectionLabel>{isError ? "Error" : "Result"}</SectionLabel>
              {renderer.resultView
                ? renderer.resultView(resultText, isError)
                : defaultResultView(resultText, isError)}
            </>
          )}

          {pair?.attachments && pair.attachments.length > 0 && (
            <>
              <SectionLabel>Hook output ({pair.attachments.length})</SectionLabel>
              <div className="space-y-2 px-3 pb-3">
                {pair.attachments.map((att, i) => (
                  <HookAttachment key={i} event={att} />
                ))}
              </div>
            </>
          )}

          {isTask && session && project && (
            <div className="border-t border-border/40 px-3 py-2">
              <SubAgentLink
                project={project}
                session={session}
                subagentType={subagentInput?.subagent_type}
                description={subagentInput?.description}
                onShowDetail={onShowDetail}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-border/30 bg-muted/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function HookAttachment({ event }: { event: SessionEvent }) {
  const raw = (event as { attachment?: Record<string, unknown> }).attachment ||
    {};
  const att = {
    hookEvent: raw.hookEvent as string | undefined,
    hookName: raw.hookName as string | undefined,
    command: raw.command as string | undefined,
    stdout: raw.stdout as string | undefined,
    stderr: raw.stderr as string | undefined,
    exitCode: raw.exitCode as number | undefined,
    durationMs: raw.durationMs as number | undefined,
  };
  return (
    <div className="rounded border border-border/40 bg-background p-2 font-mono text-[10px]">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-muted-foreground">{att.hookEvent || "hook"}</span>
        {att.hookName ? <span>{att.hookName}</span> : null}
        {att.exitCode != null && (
          <span
            className={cn(
              "rounded px-1",
              att.exitCode === 0
                ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                : "bg-red-500/20 text-red-700 dark:text-red-400",
            )}
          >
            exit {att.exitCode}
          </span>
        )}
        {att.durationMs != null && (
          <span className="text-muted-foreground">{att.durationMs}ms</span>
        )}
      </div>
      {att.command ? (
        <div className="text-foreground/80">$ {att.command}</div>
      ) : null}
      {att.stdout ? (
        <pre className="mt-1 whitespace-pre-wrap text-emerald-700 dark:text-emerald-300/80">
          {att.stdout}
        </pre>
      ) : null}
      {att.stderr ? (
        <pre className="mt-1 whitespace-pre-wrap text-red-700 dark:text-red-300/80">
          {att.stderr}
        </pre>
      ) : null}
    </div>
  );
}

function SubAgentLink({
  project,
  session,
  subagentType,
  description,
  onShowDetail,
}: {
  project: ProjectMeta;
  session: SessionMeta;
  subagentType?: string;
  description?: string;
  onShowDetail: (d: DetailContent | null) => void;
}) {
  const [agents, setAgents] = useState<
    Array<{ agentId: string; meta?: Record<string, unknown> }>
  >([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (loaded) return;
    const r = await fetch(`/api/session/${project.id}/${session.id}`);
    if (!r.ok) return;
    const j = await r.json();
    setAgents(j.subagents || []);
    setLoaded(true);
  };

  return (
    <div>
      <button
        type="button"
        onClick={load}
        className="flex w-full items-center gap-2 rounded border border-purple-500/30 bg-purple-500/5 px-2 py-1.5 text-left text-[11px] text-purple-800 transition-colors hover:bg-purple-500/10 dark:text-purple-300"
      >
        <Users aria-hidden="true" className="h-3 w-3" />
        <span className="font-medium">
          Sub-agent {subagentType && `(${subagentType})`}
        </span>
        {description && (
          <span className="truncate text-muted-foreground">
            · {description}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {loaded ? `${agents.length} threads` : "load threads"}
        </span>
      </button>
      {loaded && agents.length > 0 && (
        <ul className="mt-2 space-y-1">
          {agents.map((a) => (
            <li key={a.agentId}>
              <button
                type="button"
                onClick={() =>
                  onShowDetail({
                    kind: "subagent",
                    title: `${a.agentId}`,
                    subagent: {
                      projectId: project.id,
                      sessionId: session.id,
                      agentId: a.agentId,
                    },
                  })
                }
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ExternalLink aria-hidden="true" className="h-3 w-3" />
                <span translate="no">{a.agentId}</span>
                {a.meta &&
                  typeof (a.meta as { subagent_type?: string }).subagent_type ===
                    "string" && (
                    <span
                      className="text-purple-700 dark:text-purple-400"
                      translate="no"
                    >
                      ({String((a.meta as { subagent_type?: string }).subagent_type)})
                    </span>
                  )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
