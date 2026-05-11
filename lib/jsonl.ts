import fs from "node:fs/promises";
import type { SessionEvent } from "./types";

// Faster than readline streams for our typical jsonl sizes (a few MB at most).
// Single read + split avoids per-line async overhead.
export async function readJsonl(filePath: string): Promise<SessionEvent[]> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch {
    return [];
  }
  const events: SessionEvent[] = [];
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf("\n", i);
    const end = nl < 0 ? text.length : nl;
    if (end > i) {
      const line = text.slice(i, end);
      if (line.length > 0) {
        try {
          events.push(JSON.parse(line) as SessionEvent);
        } catch {
          // skip malformed line
        }
      }
    }
    if (nl < 0) break;
    i = nl + 1;
  }
  return events;
}

export function parseJsonlSync(text: string): SessionEvent[] {
  const out: SessionEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as SessionEvent);
    } catch {
      // skip
    }
  }
  return out;
}
