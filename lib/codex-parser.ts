import type { SessionEvent } from "./types";

interface Envelope {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

// Codex message content items: { type: "input_text" | "output_text", text }
function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((it) =>
      it && typeof it === "object" && typeof (it as { text?: string }).text === "string"
        ? (it as { text: string }).text
        : "",
    )
    .join("");
}

function roleToEventType(role: string): "user" | "assistant" | "system" {
  if (role === "assistant") return "assistant";
  if (role === "developer") return "system"; // system/permissions noise — collapsed
  return "user";
}

/**
 * Transform Codex rollout lines into Claude-shaped SessionEvents.
 * Messages + reasoning only here; tool calls are added in a later task.
 */
export function parseCodexRollout(
  lines: Envelope[],
  sessionId: string,
): SessionEvent[] {
  const events: SessionEvent[] = [];
  let i = 0;
  const mkUuid = (n: number) => `${sessionId}:${n}`;

  for (const ln of lines) {
    const p = ln.payload;
    if (!p || typeof p !== "object") continue;
    const ptype = p["type"];
    const ts = ln.timestamp ?? null;
    const uuid = mkUuid(i++);

    if (ptype === "message") {
      const role = String(p["role"] ?? "user");
      const text = textFromContent(p["content"]);
      if (!text.trim()) continue;
      const evType = roleToEventType(role);
      events.push({
        type: evType,
        uuid,
        timestamp: ts,
        message: { role: evType === "assistant" ? "assistant" : "user", content: [{ type: "text", text }] },
      } as unknown as SessionEvent);
    } else if (ptype === "reasoning") {
      const summary = p["summary"];
      const content = p["content"];
      const hasText =
        (typeof content === "string" && content.trim()) ||
        (Array.isArray(summary) && summary.length > 0);
      const thinking = hasText
        ? typeof content === "string"
          ? content
          : (summary as unknown[]).map((s) => String(s)).join("\n")
        : "(reasoning encrypted — content not stored in the rollout)";
      events.push({
        type: "assistant",
        uuid,
        timestamp: ts,
        message: { role: "assistant", content: [{ type: "thinking", thinking }] },
      } as unknown as SessionEvent);
    }
    // function_call / function_call_output handled in a later task.
    // event_msg (agent_message/user_message/task_started/token_count) is
    // intentionally dropped: response_item already carries the canonical
    // message; the event_msg variants are duplicates or runtime chatter.
  }

  return events;
}
