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

test("exec_command becomes a tool_use(Bash) + tool_result pair", () => {
  const lines = [
    { timestamp: "t1", type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "ls -la" }), call_id: "c1" } },
    { timestamp: "t2", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "total 0\n" } },
  ];
  const events = parseCodexRollout(lines, "s3");
  const toolUse = events.find((e: any) => e.message?.content?.[0]?.type === "tool_use") as any;
  expect(toolUse.message.content[0].name).toBe("exec_command");
  expect(toolUse.message.content[0].input.command).toBe("ls -la");
  const result = events.find((e: any) => e.message?.content?.[0]?.type === "tool_result") as any;
  expect(result.message.content[0].content).toContain("total 0");
  expect(result.message.content[0].tool_use_id).toBe(toolUse.message.content[0].id);
});

test("unknown MCP tool keeps its name and raw JSON input", () => {
  const lines = [
    { timestamp: "t1", type: "response_item", payload: { type: "function_call", name: "meet_join", arguments: JSON.stringify({ meet_url: "x" }), call_id: "c2" } },
    { timestamp: "t2", type: "response_item", payload: { type: "function_call_output", call_id: "c2", output: "joined" } },
  ];
  const events = parseCodexRollout(lines, "s4");
  const toolUse = events.find((e: any) => e.message?.content?.[0]?.type === "tool_use") as any;
  expect(toolUse.message.content[0].name).toBe("meet_join");
  expect(toolUse.message.content[0].input.meet_url).toBe("x");
});

test("malformed arguments fall back to a raw string input", () => {
  const events = parseCodexRollout(
    [{ timestamp: "t", type: "response_item", payload: { type: "function_call", name: "x", arguments: "{not json", call_id: "c3" } }],
    "s5",
  );
  const toolUse = events.find((e: any) => e.message?.content?.[0]?.type === "tool_use") as any;
  expect(toolUse.message.content[0].input).toEqual({ _raw: "{not json" });
});

test("apply_patch maps to Edit input with file_path + strings", () => {
  const patch = [
    "*** Begin Patch",
    "*** Update File: src/app.ts",
    "@@",
    "-const a = 1;",
    "+const a = 2;",
    "*** End Patch",
  ].join("\n");
  const events = parseCodexRollout(
    [{ timestamp: "t", type: "response_item", payload: { type: "function_call", name: "apply_patch", arguments: JSON.stringify({ input: patch }), call_id: "c9" } }],
    "s6",
  );
  const toolUse = events.find((e: any) => e.message?.content?.[0]?.type === "tool_use") as any;
  const input = toolUse.message.content[0].input;
  expect(input.file_path).toBe("src/app.ts");
  expect(input.old_string).toContain("const a = 1;");
  expect(input.new_string).toContain("const a = 2;");
});
