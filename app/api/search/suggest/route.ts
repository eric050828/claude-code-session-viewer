import { NextResponse } from "next/server";
import { getDistinctValues } from "@/lib/search-index";
import {
  HAS_VALUES,
  KNOWN_OPERATORS,
  TYPE_VALUES,
} from "@/lib/query-parser";

export const dynamic = "force-dynamic";

/**
 * Suggestion endpoint for the search autocomplete dropdown.
 *
 * Inputs:
 *   key     — empty: return operator menu; otherwise return value menu
 *   prefix  — substring filter applied to the suggested values
 *
 * Output:
 *   { suggestions: [{ value, hint?, count? }] }
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = (url.searchParams.get("key") || "").toLowerCase();
  const prefix = (url.searchParams.get("prefix") || "").toLowerCase();

  if (!key) {
    const ops = KNOWN_OPERATORS.filter((k) => k.startsWith(prefix)).map((k) => ({
      value: `${k}:`,
      hint: OPERATOR_HINTS[k],
    }));
    return NextResponse.json({ suggestions: ops });
  }

  const distinct = await getDistinctValues();
  let suggestions: Array<{ value: string; hint?: string; count?: number }> = [];

  switch (key) {
    case "tool":
      suggestions = distinct.tools
        .filter((t) => t.name.toLowerCase().startsWith(prefix))
        .slice(0, 20)
        .map((t) => ({ value: t.name, count: t.count }));
      break;
    case "branch":
      suggestions = distinct.branches
        .filter((b) => b.toLowerCase().includes(prefix))
        .slice(0, 20)
        .map((b) => ({ value: b }));
      break;
    case "model":
      suggestions = distinct.models
        .filter((m) => m.toLowerCase().includes(prefix))
        .slice(0, 20)
        .map((m) => ({ value: m }));
      break;
    case "has":
      suggestions = HAS_VALUES.filter((v) => v.startsWith(prefix)).map((v) => ({
        value: v,
        hint: HAS_HINTS[v as keyof typeof HAS_HINTS],
      }));
      break;
    case "type":
      suggestions = TYPE_VALUES.filter((v) => v.startsWith(prefix)).map((v) => ({
        value: v,
      }));
      break;
    case "before":
    case "after":
      suggestions = DATE_SHORTCUTS.filter((v) => v.value.startsWith(prefix));
      break;
    case "id":
      suggestions = [
        { value: "", hint: "Type a UUID prefix (8 chars usually enough)" },
      ];
      break;
    case "project":
      suggestions = [
        { value: "", hint: "Substring match against the project's decoded path" },
      ];
      break;
    default:
      suggestions = [];
  }
  return NextResponse.json({ suggestions });
}

const OPERATOR_HINTS: Record<string, string> = {
  id: "session UUID prefix",
  project: "project path substring",
  branch: "git branch",
  tool: "tool name (Bash, Edit, …)",
  model: "assistant model substring",
  has: "subagents / thinking / errors / active",
  type: "restrict match type",
  before: "date or relative (7d, 2026-05-01)",
  after: "date or relative (7d, 2026-05-01)",
};

const HAS_HINTS = {
  subagents: "session ran sub-agents",
  thinking: "session has thinking blocks",
  errors: "tool_result with is_error=true",
  active: "modified in the last 5 minutes",
};

const DATE_SHORTCUTS: Array<{ value: string; hint?: string }> = [
  { value: "today" },
  { value: "yesterday" },
  { value: "7d", hint: "7 days ago" },
  { value: "30d", hint: "30 days ago" },
  { value: "2026-05-01", hint: "YYYY-MM-DD also works" },
];
