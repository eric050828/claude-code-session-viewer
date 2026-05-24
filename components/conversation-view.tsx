"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  Hash,
  Loader2,
  Search,
} from "lucide-react";
import type {
  ProjectMeta,
  SessionEvent,
  SessionMeta,
  SubagentMeta,
} from "@/lib/types";
import { MessageBlock } from "./message-block";
import { MetaEventBlock } from "./meta-event-block";
import { TurnDuration } from "./turn-duration";
import { ConversationMinimap } from "./conversation-minimap";
import { SidebarToggleButton } from "./sidebar-toggle";
import { RecentSessions } from "./recent-sessions";
import { Copyable } from "./copy-button";
import { cn, cssEscape, formatTokens } from "@/lib/utils";
import { RelativeTime } from "./relative-time";
import { getShortcut, useSettings } from "@/lib/settings";
import { isInEditable, matchShortcut } from "@/lib/keyboard";
import type { DetailContent } from "./app-shell";

// Scroll-tracking tuning. See the explainer comment inside
// ConversationView for what each controls.
const ANCHOR_OFFSET_PX = 100;
const SCROLL_FLASH_MS = 1200;
const INITIAL_COMPUTE_DELAY_MS = 200;

// Build pairing map: tool_use_id → { toolUse, toolResult, attachments[], toolUseResult }
export function buildToolMap(events: SessionEvent[]) {
  const map = new Map<
    string,
    {
      toolUse: { name?: string; id?: string; input?: unknown } | null;
      toolResult: { content?: unknown; is_error?: boolean } | null;
      toolUseResult: unknown;
      attachments: SessionEvent[];
    }
  >();
  const ensure = (id: string) => {
    if (!map.has(id))
      map.set(id, {
        toolUse: null,
        toolResult: null,
        toolUseResult: null,
        attachments: [],
      });
    return map.get(id)!;
  };
  for (const ev of events) {
    if (ev.type === "assistant" || ev.type === "user") {
      const content = (ev as { message?: { content?: unknown } }).message
        ?.content;
      let lastToolResultId: string | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as {
            type?: string;
            id?: string;
            tool_use_id?: string;
            name?: string;
            input?: unknown;
            content?: unknown;
            is_error?: boolean;
          };
          if (b.type === "tool_use" && b.id) {
            const e = ensure(b.id);
            e.toolUse = { id: b.id, name: b.name, input: b.input };
          } else if (b.type === "tool_result" && b.tool_use_id) {
            const e = ensure(b.tool_use_id);
            e.toolResult = { content: b.content, is_error: b.is_error };
            lastToolResultId = b.tool_use_id;
          }
        }
      }
      // Structured tool result lives at the user-event top level.
      if (ev.type === "user") {
        const tur = (ev as { toolUseResult?: unknown }).toolUseResult;
        const stid =
          (ev as { sourceToolUseID?: string }).sourceToolUseID ||
          lastToolResultId;
        if (tur != null && stid) {
          const e = ensure(stid);
          e.toolUseResult = tur;
        }
      }
    } else if (ev.type === "attachment") {
      const id = (ev as { attachment?: { toolUseID?: string } }).attachment
        ?.toolUseID;
      if (id) {
        const e = ensure(id);
        e.attachments.push(ev);
      }
    }
  }
  return map;
}

export type ToolMap = ReturnType<typeof buildToolMap>;

export interface UsageTotals {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  messages: number;
}

export function aggregateUsage(events: SessionEvent[]): UsageTotals {
  const totals: UsageTotals = {
    input: 0,
    output: 0,
    cacheCreate: 0,
    cacheRead: 0,
    messages: 0,
  };
  for (const ev of events) {
    if (ev.type !== "assistant") continue;
    const usage = (ev as { message?: { usage?: Record<string, number> } })
      .message?.usage;
    if (!usage) continue;
    totals.messages++;
    totals.input += usage.input_tokens || 0;
    totals.output += usage.output_tokens || 0;
    totals.cacheCreate += usage.cache_creation_input_tokens || 0;
    totals.cacheRead += usage.cache_read_input_tokens || 0;
  }
  return totals;
}

const META_TYPES = new Set([
  "permission-mode",
  "last-prompt",
  "queue-operation",
  "file-history-snapshot",
  "ai-title",
  "custom-title",
  "agent-name",
  "progress",
  "pr-link",
]);

export function ConversationView({
  project,
  session,
  events,
  subagents,
  loading,
  onShowDetail,
  activeEventId,
  onActiveEventChange,
  sidebarCollapsed,
  onToggleSidebar,
  onSelectRecent,
}: {
  project: ProjectMeta | null;
  session: SessionMeta | null;
  events: SessionEvent[];
  subagents: SubagentMeta[];
  loading: boolean;
  onShowDetail: (d: DetailContent | null) => void;
  /** event uuid the URL currently points at; ConversationView scrolls to it */
  activeEventId?: string | null;
  /** sidebar state — used to render the expand button when collapsed. */
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** called when the user picks a session from the empty-state Recent list. */
  onSelectRecent?: (projectId: string, sessionId: string) => void;
  /** called when active user-msg changes.
   *  mode='replace' (default) for scroll tracking; 'push' for explicit
   *  user navigation (j/k) so the back button can step through messages. */
  onActiveEventChange?: (
    uuid: string | null,
    mode?: "replace" | "push",
  ) => void;
}) {
  const settings = useSettings();
  const toolMap = useMemo(() => buildToolMap(events), [events]);
  const usage = useMemo(() => aggregateUsage(events), [events]);
  const subagentByCwd = useMemo(() => subagents, [subagents]);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [matches, setMatches] = useState<HTMLElement[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const [messagesEl, setMessagesEl] = useState<HTMLDivElement | null>(null);
  const setMessagesRef = (el: HTMLDivElement | null) => {
    messagesRef.current = el;
    setMessagesEl(el);
  };
  const [showMeta, setShowMeta] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const didScrollRef = useRef(false);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const lastUrlAppliedRef = useRef<string | null>(null);

  // Ordered uuids of *renderable* user messages (skip the tool_result-only
  // continuations). This is the navigation set for j/k and minimap.
  const userMsgUuids = useMemo(() => {
    const out: string[] = [];
    for (const ev of events) {
      if (ev.type !== "user" || !ev.uuid) continue;
      const content = (ev as { message?: { content?: unknown } }).message?.content;
      let visible = false;
      if (typeof content === "string") {
        visible = content.trim().length > 0;
      } else if (Array.isArray(content)) {
        visible = content.some(
          (b) =>
            b &&
            typeof b === "object" &&
            (b as { type?: string }).type !== "tool_result",
        );
      }
      if (visible) out.push(ev.uuid);
    }
    return out;
  }, [events]);

  const scrollToEventEl = useCallback(
    (uuid: string, behavior: ScrollBehavior = "smooth") => {
      if (!messagesEl) return false;
      const el = messagesEl.querySelector(
        `[data-event-uuid="${cssEscape(uuid)}"]`,
      ) as HTMLElement | null;
      if (!el) return false;
      const top = el.offsetTop - 8;
      if (behavior === "smooth") {
        messagesEl.scrollTo({ top, behavior: "smooth" });
      } else {
        messagesEl.scrollTop = top;
      }
      el.classList.add("ring-2", "ring-brand", "rounded-md");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-brand", "rounded-md");
      }, SCROLL_FLASH_MS);
      return true;
    },
    [messagesEl],
  );

  // Focus the find input when the find bar opens — but only after the next
  // animation frame so we don't yank focus on touch devices that hadn't
  // intended to type yet. (We still avoid autoFocus, which is keyboard-only.)
  useEffect(() => {
    if (!findOpen) return;
    const id = requestAnimationFrame(() => findInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [findOpen]);

  // Initial scroll: if the URL points at a specific event, jump to it.
  // Otherwise scroll to bottom (existing behavior). Reset the flag on
  // session change so each new session gets one initial-scroll.
  useEffect(() => {
    if (session?.id !== sessionIdRef.current) {
      sessionIdRef.current = session?.id ?? null;
      didScrollRef.current = false;
      lastUrlAppliedRef.current = null;
    }
    if (didScrollRef.current) return;
    if (!messagesEl || events.length === 0) return;
    const raf = requestAnimationFrame(() => {
      if (activeEventId && scrollToEventEl(activeEventId, "auto")) {
        lastUrlAppliedRef.current = activeEventId;
      } else if (settings.autoScrollBottom) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      didScrollRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [session?.id, events, messagesEl, activeEventId, scrollToEventEl]);

  // Subsequent activeEventId changes (e.g. browser back/forward to a
  // different event in the same session) — scroll there.
  useEffect(() => {
    if (!didScrollRef.current) return;
    if (!activeEventId) return;
    if (activeEventId === lastUrlAppliedRef.current) return;
    if (scrollToEventEl(activeEventId, "smooth")) {
      lastUrlAppliedRef.current = activeEventId;
    }
  }, [activeEventId, scrollToEventEl]);

  // Track which user message is at the top of the viewport.
  //
  // Earlier attempts:
  //   (a) per-scroll getBoundingClientRect on every msg → O(N) layout
  //       reads per frame, kills perf on 1000+ msg sessions.
  //   (b) IntersectionObserver — efficient, but the callback only fires
  //       on threshold crossings. An element that scrolls from "below
  //       view" to "above view" without ever intersecting the root
  //       (fast jump, e.g. scroll-to-bottom) emits no event, so the
  //       set of "messages above the anchor" goes stale.
  //
  // Current approach: cache offsetTop once per layout, then on scroll
  // do a binary search for the last msg with offsetTop ≤ scrollTop+100.
  // O(log N) per scroll, no layout reads inside the hot path.
  useEffect(() => {
    if (!messagesEl) return;
    if (!onActiveEventChange) return;
    if (!userMsgUuids.length) return;

    // Snapshot positions. offsetTop is read once per dependency change.
    // ResizeObserver below invalidates the snapshot when content reflows.
    let positions: number[] = [];
    let needsRefresh = true;
    const refreshPositions = () => {
      positions = userMsgUuids.map((uuid) => {
        const el = messagesEl.querySelector(
          `[data-event-uuid="${cssEscape(uuid)}"]`,
        ) as HTMLElement | null;
        return el ? el.offsetTop : Number.MAX_SAFE_INTEGER;
      });
      needsRefresh = false;
    };

    let raf: number | null = null;
    const computeActive = () => {
      raf = null;
      if (needsRefresh) refreshPositions();
      const scrollTop = messagesEl.scrollTop;
      const anchor = scrollTop + ANCHOR_OFFSET_PX;
      // Binary search for the last position <= anchor.
      let lo = 0;
      let hi = positions.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (positions[mid] <= anchor) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      const active = found >= 0 ? userMsgUuids[found] : null;
      if (active !== lastUrlAppliedRef.current) {
        lastUrlAppliedRef.current = active;
        onActiveEventChange(active);
      }
    };

    const onScroll = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(computeActive);
    };

    // Reflows: thinking blocks toggle open/closed, images load, content
    // streams in. Invalidate the snapshot and recompute lazily.
    const resizeObserver = new ResizeObserver(() => {
      needsRefresh = true;
      if (raf == null) raf = requestAnimationFrame(computeActive);
    });
    resizeObserver.observe(messagesEl);
    // Also observe the inner scroll content so child reflows count.
    const content = messagesEl.firstElementChild;
    if (content) resizeObserver.observe(content);

    messagesEl.addEventListener("scroll", onScroll, { passive: true });
    // Initial compute after layout settles.
    const t = setTimeout(() => {
      needsRefresh = true;
      computeActive();
    }, INITIAL_COMPUTE_DELAY_MS);

    return () => {
      messagesEl.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      if (raf != null) cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [messagesEl, userMsgUuids, onActiveEventChange]);

  // Prev / next user message — bound to the user's configured shortcuts.
  // Each direction can be any combo (bare letter, modified, named key).
  // Skips bare-key combos when focus is in an editable element so the
  // user can still type those letters into the search/find inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const prevCombo = getShortcut(settings, "nav.prev");
      const nextCombo = getShortcut(settings, "nav.next");
      const isPrev = matchShortcut(prevCombo, e);
      const isNext = matchShortcut(nextCombo, e);
      if (!isPrev && !isNext) return;
      // Gate bare-key combos in inputs (a bare key is one with no Mod/Alt
      // — we infer that from the event itself).
      const bare = !(e.metaKey || e.ctrlKey || e.altKey);
      if (bare && isInEditable(e)) return;
      if (!userMsgUuids.length) return;
      e.preventDefault();
      const current = lastUrlAppliedRef.current;
      const idx = current ? userMsgUuids.indexOf(current) : -1;
      const direction = isNext ? +1 : -1;
      let target_idx: number;
      if (idx < 0) {
        target_idx = direction > 0 ? 0 : userMsgUuids.length - 1;
      } else {
        target_idx = Math.max(
          0,
          Math.min(userMsgUuids.length - 1, idx + direction),
        );
      }
      if (target_idx === idx) return;
      const targetUuid = userMsgUuids[target_idx];
      if (scrollToEventEl(targetUuid, "smooth")) {
        lastUrlAppliedRef.current = targetUuid;
        // Push history so the back button steps through user nav.
        onActiveEventChange?.(targetUuid, "push");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [userMsgUuids, scrollToEventEl, onActiveEventChange, settings.shortcuts]);

  // Find-in-session handler — bound to the configured shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchShortcut(getShortcut(settings, "find.open"), e)) {
        e.preventDefault();
        setFindOpen(true);
      }
      if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
        setFindQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, settings.shortcuts]);

  // Recompute matches when query changes
  useEffect(() => {
    if (!findQuery || !messagesRef.current) {
      // clear highlights
      messagesRef.current
        ?.querySelectorAll(".highlight-mark")
        .forEach((el) => {
          const parent = el.parentNode!;
          parent.replaceChild(document.createTextNode(el.textContent || ""), el);
          parent.normalize();
        });
      setMatches([]);
      return;
    }
    const root = messagesRef.current;
    // remove existing highlights
    root.querySelectorAll(".highlight-mark").forEach((el) => {
      const parent = el.parentNode!;
      parent.replaceChild(document.createTextNode(el.textContent || ""), el);
      parent.normalize();
    });

    const q = findQuery;
    const newMatches: HTMLElement[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (
          node.parentElement?.closest("[data-skip-find]") ||
          node.parentElement?.tagName === "SCRIPT" ||
          node.parentElement?.tagName === "STYLE"
        )
          return NodeFilter.FILTER_REJECT;
        return node.nodeValue.toLowerCase().includes(q.toLowerCase())
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    const targets: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) targets.push(n as Text);

    for (const t of targets) {
      const text = t.nodeValue!;
      const lower = text.toLowerCase();
      const ql = q.toLowerCase();
      const frag = document.createDocumentFragment();
      let i = 0;
      while (i < text.length) {
        const idx = lower.indexOf(ql, i);
        if (idx < 0) {
          frag.appendChild(document.createTextNode(text.slice(i)));
          break;
        }
        if (idx > i)
          frag.appendChild(document.createTextNode(text.slice(i, idx)));
        const mark = document.createElement("mark");
        mark.className = "highlight-mark";
        mark.textContent = text.slice(idx, idx + ql.length);
        frag.appendChild(mark);
        newMatches.push(mark);
        i = idx + ql.length;
      }
      t.parentNode?.replaceChild(frag, t);
    }

    setMatches(newMatches);
    setFindIndex(0);
    if (newMatches[0])
      newMatches[0].scrollIntoView({ behavior: "smooth", block: "center" });
  }, [findQuery, events]);

  const navigateFind = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (findIndex + dir + matches.length) % matches.length;
    setFindIndex(next);
    matches.forEach((m, i) => {
      m.classList.toggle("ring-2", i === next);
      m.classList.toggle("ring-brand", i === next);
    });
    matches[next].scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (!session) {
    return (
      <div id="main" className="relative flex h-full flex-col overflow-y-auto">
        {sidebarCollapsed && onToggleSidebar && (
          <div className="absolute left-2 top-2 z-10">
            <SidebarToggleButton collapsed onToggle={onToggleSidebar} />
          </div>
        )}
        <div className="flex flex-1 flex-col items-center px-6 py-10">
          <p className="mb-6 text-center text-sm text-muted-foreground">
            Pick a session from the sidebar — or jump back into something you
            were just looking at.
          </p>
          {onSelectRecent && <RecentSessions onSelect={onSelectRecent} />}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} id="main" className="flex h-full flex-col">
      {/* session header */}
      <div className="shrink-0 border-b border-border bg-card/60 px-5 py-3">
        <div className="flex items-start gap-3">
          {sidebarCollapsed && onToggleSidebar && (
            <SidebarToggleButton
              collapsed
              onToggle={onToggleSidebar}
              className="-ml-1 mt-0.5"
            />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">
              {session.title}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <Copyable text={session.id}>
                <span className="flex items-center gap-1 font-mono" translate="no">
                  <Hash aria-hidden="true" className="h-3 w-3" />
                  {session.id}
                </span>
              </Copyable>
              {session.gitBranch && (
                <Copyable text={session.gitBranch}>
                  <span
                    className="flex items-center gap-1 font-mono"
                    translate="no"
                  >
                    <GitBranch aria-hidden="true" className="h-3 w-3" />
                    {session.gitBranch}
                  </span>
                </Copyable>
              )}
              {session.cwd && (
                <Copyable text={session.cwd}>
                  <span className="font-mono opacity-70" translate="no">
                    {session.cwd}
                  </span>
                </Copyable>
              )}
              <span>· <RelativeTime ts={session.lastTimestamp} /></span>
              <span>· {session.messageCount} messages</span>
              {session.toolUseCount > 0 && (
                <span>· {session.toolUseCount} tool uses</span>
              )}
              {subagentByCwd.length > 0 && (
                <span className="text-purple-700 dark:text-purple-400">
                  · {subagentByCwd.length} sub-agents
                </span>
              )}
              {usage.messages > 0 && (
                <span
                  className="rounded border border-border/40 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px]"
                  title={
                    `Aggregate token usage across ${usage.messages} assistant messages. ` +
                    `Input ${usage.input.toLocaleString()}; ` +
                    `output ${usage.output.toLocaleString()}; ` +
                    `cache create ${usage.cacheCreate.toLocaleString()}; ` +
                    `cache read ${usage.cacheRead.toLocaleString()}.`
                  }
                  aria-label={`Total tokens: ${formatTokens(usage.input + usage.cacheCreate + usage.cacheRead)} in, ${formatTokens(usage.output)} out`}
                >
                  <span className="text-emerald-700 dark:text-emerald-400">
                    ↓{formatTokens(usage.input + usage.cacheCreate + usage.cacheRead)}
                  </span>
                  <span aria-hidden="true" className="mx-1 text-muted-foreground">
                    /
                  </span>
                  <span className="text-amber-700 dark:text-amber-300">
                    ↑{formatTokens(usage.output)}
                  </span>
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowMeta((s) => !s)}
              aria-pressed={showMeta}
              aria-label={showMeta ? "Hide meta events" : "Show meta events"}
              className={cn(
                "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] transition-colors",
                showMeta
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Toggle meta events (permission-mode, snapshots, etc.)"
            >
              {showMeta ? (
                <ChevronDown aria-hidden="true" className="h-3 w-3" />
              ) : (
                <ChevronRight aria-hidden="true" className="h-3 w-3" />
              )}
              Meta
            </button>
            <button
              type="button"
              onClick={() => setFindOpen(true)}
              aria-label="Find in session (Ctrl/Cmd + F)"
              aria-keyshortcuts="Meta+F Control+F"
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Search aria-hidden="true" className="h-3 w-3" />
              Find <kbd className="font-mono">{"⌘ F"}</kbd>
            </button>
          </div>
        </div>
      </div>

      {/* find bar */}
      {findOpen && (
        <div className="shrink-0 border-b border-border bg-background px-4 py-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1 transition-shadow focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/40">
            <Search aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              ref={findInputRef}
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") navigateFind(e.shiftKey ? -1 : 1);
                if (e.key === "Escape") {
                  setFindOpen(false);
                  setFindQuery("");
                }
              }}
              placeholder="Find in session…"
              aria-label="Find text in this session"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0"
            />
            <span
              aria-live="polite"
              className="text-[11px] tabular-nums text-muted-foreground"
            >
              {matches.length === 0
                ? findQuery
                  ? "no matches"
                  : ""
                : `${findIndex + 1} / ${matches.length}`}
            </span>
            <button
              type="button"
              onClick={() => navigateFind(-1)}
              aria-label="Previous match (Shift + Enter)"
              className="rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <ChevronRight aria-hidden="true" className="h-3 w-3 rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => navigateFind(1)}
              aria-label="Next match (Enter)"
              className="rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <ChevronRight aria-hidden="true" className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => {
                setFindOpen(false);
                setFindQuery("");
              }}
              aria-label="Close find bar"
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              Esc
            </button>
          </div>
        </div>
      )}

      {/* message list (with minimap on right edge) */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={setMessagesRef}
          className="absolute inset-0 overflow-y-auto scrollbar-thin px-1 pr-7"
        >
        {loading && (
          <div
            aria-live="polite"
            className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
          >
            <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
            Loading session…
          </div>
        )}
        {!loading && events.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            (no events)
          </div>
        )}
        {!loading &&
          events.map((ev, i) => {
            // Skip standalone attachments that link to a tool we render inline
            if (ev.type === "attachment") {
              const id = (ev as { attachment?: { toolUseID?: string } })
                .attachment?.toolUseID;
              if (id && toolMap.has(id)) return null;
            }
            // Turn duration: always shown as a boundary divider (not under Meta).
            if (
              ev.type === "system" &&
              (ev as { subtype?: string }).subtype === "turn_duration"
            ) {
              return <TurnDuration key={(ev.uuid as string) || i} event={ev} />;
            }
            // Meta events: only render when toggle on
            if (META_TYPES.has(ev.type)) {
              if (!showMeta) return null;
              return <MetaEventBlock key={i} event={ev} />;
            }
            return (
              <MessageBlock
                key={(ev.uuid as string) || i}
                event={ev}
                toolMap={toolMap}
                project={project}
                session={session}
                onShowDetail={onShowDetail}
              />
            );
          })}
        </div>
        {settings.showMinimap && (
          <ConversationMinimap
            events={events}
            scrollContainer={messagesEl}
          />
        )}
      </div>
    </div>
  );
}
