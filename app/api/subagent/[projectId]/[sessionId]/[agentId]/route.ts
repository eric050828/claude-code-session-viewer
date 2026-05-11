import { NextResponse } from "next/server";
import { loadSubagent } from "@/lib/session-loader";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: { projectId: string; sessionId: string; agentId: string };
  },
) {
  try {
    const events = await loadSubagent(
      params.projectId,
      params.sessionId,
      params.agentId,
    );
    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 404 },
    );
  }
}
