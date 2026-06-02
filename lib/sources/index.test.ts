import { test, expect } from "vitest";
import { encodeProjectId, decodeProjectId } from "./index";

test("claude ids are unprefixed (back-compat)", () => {
  expect(encodeProjectId("claude", "-home-eric")).toBe("-home-eric");
  expect(decodeProjectId("-home-eric")).toEqual({
    source: "claude",
    rawId: "-home-eric",
  });
});

test("codex ids carry a codex: prefix", () => {
  expect(encodeProjectId("codex", "abc123")).toBe("codex:abc123");
  expect(decodeProjectId("codex:abc123")).toEqual({
    source: "codex",
    rawId: "abc123",
  });
});
