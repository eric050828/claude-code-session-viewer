import { NextResponse } from "next/server";
import { search } from "@/lib/search-index";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const limit = Number(url.searchParams.get("limit") || 50);
  const hits = await search(q, limit);
  return NextResponse.json({ hits });
}
