import { NextResponse } from "next/server";
import { listProjects, listSessions } from "@/lib/session-loader";
import { pMap } from "@/lib/cache";
import type { ProjectMeta, SessionMeta } from "@/lib/types";

export const dynamic = "force-dynamic";

interface RecentSession {
  session: SessionMeta;
  projectId: string;
  projectDecodedPath: string;
}

/**
 * Returns the most-recent sessions across all projects, sorted by
 * lastTimestamp desc. Used by the empty state in ConversationView.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") || 12)),
  );

  const projects = await listProjects();
  const projectMap = new Map<string, ProjectMeta>(projects.map((p) => [p.id, p]));

  const buckets: RecentSession[][] = [];
  await pMap(projects, 6, async (p) => {
    try {
      const sessions = await listSessions(p.id);
      buckets.push(
        sessions.map((s) => ({
          session: s,
          projectId: p.id,
          projectDecodedPath: projectMap.get(p.id)?.decodedPath || p.id,
        })),
      );
    } catch {
      // skip unreadable project
    }
  });

  const all = buckets.flat();
  all.sort((a, b) => {
    const ta = a.session.lastTimestamp
      ? Date.parse(a.session.lastTimestamp)
      : 0;
    const tb = b.session.lastTimestamp
      ? Date.parse(b.session.lastTimestamp)
      : 0;
    return tb - ta;
  });

  return NextResponse.json({ recent: all.slice(0, limit) });
}
