import { test, expect } from "vitest";
import { parseQuery } from "./query-parser";

test("source operator parses", () => {
  const q = parseQuery("source:codex exec");
  const t = q.filters.find((f) => f.key === "source");
  expect(t?.value).toBe("codex");
  expect(q.freeText).toBe("exec");
});
