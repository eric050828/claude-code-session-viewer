import os from "node:os";
import path from "node:path";

export function claudeProjectsRoot(): string {
  const override = process.env.CCSV_PROJECTS_DIR;
  if (override) return override;
  return path.join(os.homedir(), ".claude", "projects");
}

// Convert encoded folder name back to a real-looking path.
// Claude Code encodes a project's absolute path by replacing "/" with "-",
// and underscores in the original path also collapse to "-", so the mapping
// is lossy. The fix-up at call sites uses the `cwd` from a real event when
// possible; this helper is the best-effort fallback when no events exist.
// Algorithm: drop leading "-" → split on "-" → rejoin with "/".
export function decodeProjectId(id: string): string {
  if (!id) return "";
  const trimmed = id.startsWith("-") ? id.slice(1) : id;
  return "/" + trimmed.split("-").join("/");
}

export function encodeProjectPath(absPath: string): string {
  return absPath.replace(/\//g, "-");
}
