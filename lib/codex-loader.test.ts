import { test, expect } from "vitest";
import { codexProjectId } from "./codex-loader";

test("codexProjectId is stable for a cwd", () => {
  expect(codexProjectId("/home/eric/proj")).toBe(codexProjectId("/home/eric/proj"));
  expect(codexProjectId("/home/eric/a")).not.toBe(codexProjectId("/home/eric/b"));
});
