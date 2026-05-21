"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionEvent } from "@/lib/types";
import { cn, cssEscape, truncate } from "@/lib/utils";

interface UserNode {
  uuid: string;
  preview: string;
  index: number;
}

function extractUserPreview(ev: SessionEvent): string | null {
  if (ev.type !== "user") return null;
  const msg = (ev as { message?: { content?: unknown } }).message;
  const content = msg?.content;
  if (typeof content === "string") {
    return content.trim() || null;
  }
  if (!Array.isArray(content)) return null;
  // Skip pure tool_result messages — they aren't rendered as user blocks.
  const hasNonToolResult = content.some(
    (b) => b && typeof b === "object" && (b as { type?: string }).type !== "tool_result",
  );
  if (!hasNonToolResult) return null;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      // Skip noisy reminders / tool_use_result envelopes
      const t = b.text.trim();
      if (t.startsWith("<")) continue;
      return t;
    }
  }
  return "(attachment / continuation)";
}

export function ConversationMinimap({
  events,
  scrollContainer,
}: {
  events: SessionEvent[];
  scrollContainer: HTMLDivElement | null;
}) {
  const nodes = useMemo<UserNode[]>(() => {
    const out: UserNode[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev.uuid) continue;
      const preview = extractUserPreview(ev);
      if (preview == null) continue;
      out.push({ uuid: ev.uuid, preview, index: i });
    }
    return out;
  }, [events]);

  // Each node's vertical position as % of scrollHeight.
  const [positions, setPositions] = useState<number[]>([]);
  // Visible window: top% + height%
  const [viewport, setViewport] = useState({ top: 0, height: 100 });
  const [activeIndex, setActiveIndex] = useState(-1);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const trackRef = useRef<HTMLDivElement>(null);

  const recompute = useCallback(() => {
    if (!scrollContainer) return;
    const h = scrollContainer.scrollHeight || 1;
    const positions = nodes.map((n) => {
      const el = scrollContainer.querySelector(
        `[data-event-uuid="${cssEscape(n.uuid)}"]`,
      ) as HTMLElement | null;
      if (!el) return 0;
      return (el.offsetTop / h) * 100;
    });
    setPositions(positions);
    const top = (scrollContainer.scrollTop / h) * 100;
    const height = (scrollContainer.clientHeight / h) * 100;
    setViewport({ top, height });
    // active = last node with position <= top + 20% of viewport
    const cursor = top + Math.min(15, height / 2);
    let active = -1;
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] <= cursor) active = i;
      else break;
    }
    setActiveIndex(active);
  }, [scrollContainer, nodes]);

  useEffect(() => {
    if (!scrollContainer) return;
    // initial + on scroll/resize
    const onScroll = () => recompute();
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => recompute());
    ro.observe(scrollContainer);
    // also observe the inner content for size changes (lazy renders, expansions)
    const mo = new MutationObserver(() => recompute());
    mo.observe(scrollContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    // initial pass — content needs to layout first
    const t = setTimeout(recompute, 50);
    const t2 = setTimeout(recompute, 250);
    return () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [scrollContainer, recompute]);

  const jumpTo = useCallback(
    (uuid: string) => {
      if (!scrollContainer) return;
      const el = scrollContainer.querySelector(
        `[data-event-uuid="${cssEscape(uuid)}"]`,
      ) as HTMLElement | null;
      if (!el) return;
      const padding = 12;
      scrollContainer.scrollTo({
        top: el.offsetTop - padding,
        behavior: "smooth",
      });
      el.classList.add("ring-2", "ring-brand", "rounded-md");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-brand", "rounded-md");
      }, 1500);
    },
    [scrollContainer],
  );

  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrollContainer || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const target = scrollContainer.scrollHeight * ratio;
    scrollContainer.scrollTo({
      top: target - scrollContainer.clientHeight / 2,
      behavior: "smooth",
    });
  };

  if (nodes.length === 0) return null;

  return (
    <div
      role="navigation"
      aria-label="Conversation minimap"
      className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-6 select-none"
    >
      {/* track — click-to-scroll is a mouse-only convenience; node buttons
          below are the accessible interface for keyboard users. */}
      <div
        ref={trackRef}
        onClick={onTrackClick}
        aria-hidden="true"
        className="pointer-events-auto relative ml-auto h-full w-full cursor-pointer"
      >
        {/* vertical line */}
        <div className="absolute bottom-2 left-1/2 top-2 w-px -translate-x-1/2 bg-border/50" />
        {/* viewport indicator */}
        <div
          className="absolute left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-brand/20 transition-[top,height] duration-150 ease-out motion-reduce:transition-none"
          style={{
            top: `calc(${viewport.top}% + 8px)`,
            height: `max(12px, calc(${viewport.height}% - 16px))`,
          }}
        />
      </div>
      {/* nodes are siblings of the (aria-hidden) track so they remain
          accessible and not nested inside an aria-hidden ancestor. */}
      {nodes.map((n, i) => {
        const top = positions[i] ?? 0;
        const isActive = i === activeIndex;
        const isHover = i === hoverIndex;
        return (
          <button
            key={n.uuid}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              jumpTo(n.uuid);
            }}
            onMouseEnter={() => setHoverIndex(i)}
            onMouseLeave={() => setHoverIndex(-1)}
            onFocus={() => setHoverIndex(i)}
            onBlur={() => setHoverIndex(-1)}
            className={cn(
              "group/node pointer-events-auto absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[background-color,width,height] duration-150 motion-reduce:transition-none",
              isActive
                ? "h-2.5 w-2.5 bg-brand ring-2 ring-brand/30"
                : isHover
                  ? "h-2.5 w-2.5 bg-role-user"
                  : "h-1.5 w-1.5 bg-muted-foreground/60 hover:bg-role-user",
            )}
            style={{ top: `calc(${top}% + 8px)` }}
            title={truncate(n.preview, 200)}
            aria-label={`Jump to user message ${i + 1}: ${truncate(n.preview.replace(/\s+/g, " "), 120)}`}
          >
            {isHover && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-lg"
              >
                <span className="mr-2 font-mono text-muted-foreground">
                  #{i + 1}
                </span>
                {truncate(n.preview.replace(/\s+/g, " "), 80)}
              </span>
            )}
          </button>
        );
      })}
      {/* counter */}
      <div
        aria-hidden="true"
        className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-muted/60 px-1 py-0.5 font-mono text-[9px] tabular-nums text-muted-foreground"
      >
        {activeIndex < 0 ? 0 : activeIndex + 1}/{nodes.length}
      </div>
    </div>
  );
}

