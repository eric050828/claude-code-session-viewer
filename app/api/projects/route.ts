import { NextResponse } from "next/server";
import { listProjects } from "@/lib/sources";
import { warmSearchIndex } from "@/lib/search-index";

export const dynamic = "force-dynamic";

export async function GET() {
  const projects = await listProjects();
  // Kick off search index build in the background so the first ⌘K is fast.
  // Fire-and-forget; safe since rebuildIfNeeded de-duplicates concurrent builds.
  warmSearchIndex();
  return NextResponse.json({ projects });
}
