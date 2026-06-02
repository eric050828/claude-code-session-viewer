import { test, expect } from "vitest";
import { codexSessionsRoot } from "./codex-paths";

test("honors CCSV_CODEX_DIR override", () => {
  const prev = process.env.CCSV_CODEX_DIR;
  process.env.CCSV_CODEX_DIR = "/tmp/mock-codex";
  expect(codexSessionsRoot()).toBe("/tmp/mock-codex");
  if (prev === undefined) delete process.env.CCSV_CODEX_DIR;
  else process.env.CCSV_CODEX_DIR = prev;
});
