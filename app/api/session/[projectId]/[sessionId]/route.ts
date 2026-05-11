import { NextResponse } from "next/server";
import { listSubagents, loadSession } from "@/lib/session-loader";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { projectId: string; sessionId: string } },
) {
  try {
    const events = await loadSession(params.projectId, params.sessionId);
    const subagents = await listSubagents(params.projectId, params.sessionId);
    return NextResponse.json({ events, subagents });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 404 },
    );
  }
}
