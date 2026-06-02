import { NextResponse } from "next/server";
import { listSessions } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { projectId: string } },
) {
  const sessions = await listSessions(params.projectId);
  return NextResponse.json({ sessions });
}
