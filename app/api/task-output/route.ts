import { NextResponse } from "next/server";
import fs from "node:fs/promises";

export const dynamic = "force-dynamic";

// Claude Code writes background tool output to /tmp/claude-<uid>/<encoded-project>/<session>/tasks/<task-id>.output.
// Only those paths are allowed — anything else returns 400 so this endpoint can't
// double as a generic file-read RCE.
const ALLOWED_PATH = /^\/tmp\/claude-[^/]+\/[^/]+\/[^/]+\/tasks\/[^/]+\.output$/;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — UI shouldn't render larger blobs anyway

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path || !ALLOWED_PATH.test(path)) {
    return NextResponse.json(
      { error: "path must match the Claude Code task-output convention" },
      { status: 400 },
    );
  }
  let stat;
  try {
    stat = await fs.stat(path);
  } catch {
    return NextResponse.json(
      { error: "file not found (background output is in /tmp and is cleared on reboot)", path, exists: false },
      { status: 404 },
    );
  }
  try {
    let content: string;
    let truncated = false;
    if (stat.size > MAX_BYTES) {
      const fh = await fs.open(path, "r");
      const buf = Buffer.alloc(MAX_BYTES);
      await fh.read(buf, 0, MAX_BYTES, stat.size - MAX_BYTES);
      await fh.close();
      content =
        `… (${(stat.size / 1024 / 1024).toFixed(1)}MB truncated; showing last 2MB)\n` +
        buf.toString("utf-8");
      truncated = true;
    } else {
      content = await fs.readFile(path, "utf-8");
    }
    return NextResponse.json({
      path,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      content,
      truncated,
      exists: true,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message, path, exists: false },
      { status: 500 },
    );
  }
}
