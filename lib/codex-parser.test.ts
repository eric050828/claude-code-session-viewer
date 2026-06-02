import { test, expect } from "vitest";
import { parseCodexRollout } from "./codex-parser";

const lines = [
  { timestamp: "2026-06-01T18:00:00Z", type: "session_meta", payload: { id: "s1", cwd: "/home/eric/proj", timestamp: "2026-06-01T18:00:00Z" } },
  { timestamp: "2026-06-01T18:00:01Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] } },
  { timestamp: "2026-06-01T18:00:02Z", type: "event_msg", payload: { type: "user_message", message: "hello" } },
  { timestamp: "2026-06-01T18:00:03Z", type: "response_item", payload: { type: "reasoning", summary: "[]", content: null, encrypted_content: "gAAA..." } },
  { timestamp: "2026-06-01T18:00:04Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi there" }] } },
  { timestamp: "2026-06-01T18:00:05Z", type: "event_msg", payload: { type: "agent_message", message: "hi there" } },
];

test("dedups event_msg against response_item; maps roles + reasoning", () => {
  const events = parseCodexRollout(lines, "s1");
  const types = events.map((e) => e.type);
  expect(types).toEqual(["user", "assistant", "assistant"]);
  const user = events[0] as any;
  expect(user.message.content[0]).toMatchObject({ type: "text", text: "hello" });
  const reasoning = events[1] as any;
  expect(reasoning.message.content[0].type).toBe("thinking");
  expect(reasoning.message.content[0].thinking).toContain("encrypted");
  const asst = events[2] as any;
  expect(asst.message.content[0]).toMatchObject({ type: "text", text: "hi there" });
});

test("developer role maps to system", () => {
  const events = parseCodexRollout(
    [{ timestamp: "t", type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "<permissions>" }] } }],
    "s2",
  );
  expect(events[0].type).toBe("system");
});
